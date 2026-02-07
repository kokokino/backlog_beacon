import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// EA GraphQL API endpoint (from EA App / Playnite source)
const EA_GRAPHQL_URL = 'https://service-aggregation-layer.juno.ea.com/graphql';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;
const MAX_PAGES = 20;
const PAGE_SIZE = 500;

// Sleep helper for retry logic
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with retry logic for rate limiting
async function fetchWithRetry(url, options = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        console.log(`EA API rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
        lastError = new Error('EA API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Meteor.Error('auth-invalid', 'Bearer token is invalid or expired. Please get a new token from ea.com.');
      }

      if (!response.ok) {
        throw new Error(`EA API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      // Re-throw Meteor errors immediately
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(`EA API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', 'Could not connect to EA. Please try again later.');
}

// Build GraphQL query URL (EA uses query parameter style, not POST)
function buildGraphQLUrl(query) {
  const encodedQuery = encodeURIComponent(query);
  return `${EA_GRAPHQL_URL}?query=${encodedQuery}`;
}

// Fetch all owned games from EA with pagination
async function fetchEaOwnedGames(bearerToken) {
  const allItems = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const pagingClause = cursor
      ? `paging: { limit: ${PAGE_SIZE}, next: "${cursor}" }`
      : `paging: { limit: ${PAGE_SIZE} }`;

    const query = `query {
      me {
        ownedGameProducts(
          locale: "DEFAULT"
          entitlementEnabled: true
          storefronts: [EA]
          type: [DIGITAL_FULL_GAME, PACKAGED_FULL_GAME]
          platforms: [PC]
          ${pagingClause}
        ) {
          items {
            originOfferId
            product {
              id
              name
              gameSlug
              baseItem {
                isLauncher
                gameType
              }
              gameProductUser {
                ownershipMethods
              }
            }
          }
          next
        }
      }
    }`;

    const url = buildGraphQLUrl(query);
    const response = await fetchWithRetry(url, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    // Check for GraphQL errors
    if (data.errors && data.errors.length > 0) {
      const error = data.errors[0];
      if (error.message?.includes('unauthorized') || error.message?.includes('Unauthorized')) {
        throw new Meteor.Error('auth-invalid', 'Bearer token is invalid or expired. Please get a new token from ea.com.');
      }
      throw new Meteor.Error('api-error', `EA API error: ${error.message || 'Unknown error'}`);
    }

    const ownedProducts = data?.data?.me?.ownedGameProducts;
    const items = ownedProducts?.items || [];
    allItems.push(...items);

    // Check for next page
    const nextCursor = ownedProducts?.next;
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  return allItems;
}

// Fetch playtime data for game slugs
async function fetchEaPlaytimes(bearerToken, gameSlugs) {
  const playtimeMap = new Map();

  if (!gameSlugs || gameSlugs.length === 0) {
    return playtimeMap;
  }

  // Process in chunks of 50 to avoid overly long URLs
  const chunkSize = 50;
  for (let start = 0; start < gameSlugs.length; start += chunkSize) {
    const chunk = gameSlugs.slice(start, start + chunkSize);
    const slugsJson = JSON.stringify(chunk);

    try {
      const query = `query { me { recentGames(gameSlugs: ${slugsJson}) { items { gameSlug totalPlayTimeSeconds lastSessionEndDate } } } }`;
      const url = buildGraphQLUrl(query);

      const response = await fetchWithRetry(url, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Accept': 'application/json'
        }
      });

      const data = await response.json();
      const items = data?.data?.me?.recentGames?.items || [];

      for (const item of items) {
        if (item.gameSlug && item.totalPlayTimeSeconds) {
          // Convert seconds to hours, rounded to 1 decimal place
          const hours = Math.round((item.totalPlayTimeSeconds / 3600) * 10) / 10;
          playtimeMap.set(item.gameSlug, hours);
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch EA playtime for chunk starting at ${start}:`, error.message);
      // Continue with other chunks
    }
  }

  return playtimeMap;
}

// Filter and deduplicate EA games
function filterEaGames(items) {
  const seen = new Set();
  const filtered = [];

  for (const item of items) {
    // Skip items without a product name
    if (!item.product?.name) {
      continue;
    }

    // Skip launcher items
    if (item.product?.baseItem?.isLauncher === true) {
      continue;
    }

    // Deduplicate by originOfferId
    const offerId = item.originOfferId;
    if (offerId && seen.has(offerId)) {
      continue;
    }
    if (offerId) {
      seen.add(offerId);
    }

    filtered.push(item);
  }

  return filtered;
}

// Normalize EA game name for better IGDB matching
function normalizeEaGameName(name) {
  let normalized = name;

  // Strip trademark symbols
  normalized = normalized.replace(/[™®©]/g, '');

  // Remove common edition suffixes for better matching
  normalized = normalized.replace(/\s*[-–—:]\s*(Deluxe|Standard|Ultimate|Gold|Premium|Complete|Game of the Year|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*Edition\s*$/i, '');

  // Remove trailing "Edition" if preceded by a named edition
  normalized = normalized.replace(/\s+(Deluxe|Standard|Ultimate|Gold|Premium|Complete|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*$/i, '');

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// Update progress in the database
async function updateProgress(userId, progressData) {
  await ImportProgress.upsertAsync(
    { userId, type: 'storefront' },
    {
      $set: {
        ...progressData,
        userId,
        type: 'storefront',
        updatedAt: new Date()
      }
    }
  );
}

// Main import function
export async function importEaLibrary(userId, bearerToken, options = {}) {
  const { updateExisting = true, importPlaytime = true } = options;

  // Fetch all owned games
  const allItems = await fetchEaOwnedGames(bearerToken);

  // Filter and deduplicate
  const gameItems = filterEaGames(allItems);

  if (gameItems.length === 0) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      games: []
    };
  }

  // Fetch playtime if requested
  let playtimeMap = new Map();
  if (importPlaytime) {
    const gameSlugs = gameItems
      .map(item => item.product?.gameSlug)
      .filter(Boolean);
    playtimeMap = await fetchEaPlaytimes(bearerToken, gameSlugs);
  }

  // Build games array
  const games = gameItems.map(item => ({
    title: item.product.name,
    gameSlug: item.product.gameSlug,
    originOfferId: item.originOfferId,
    hoursPlayed: playtimeMap.get(item.product?.gameSlug) || null
  }));

  // Sort by playtime (most played first) for better UX
  games.sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0));

  // Process the import
  return processEaImport(userId, games, { updateExisting, importPlaytime });
}

// Process import - following Epic/Oculus patterns
async function processEaImport(userId, games, options) {
  const { updateExisting, importPlaytime } = options;

  const results = {
    total: games.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    games: []
  };

  const igdbEnabled = isConfigured();

  // Initialize progress
  await updateProgress(userId, {
    status: 'processing',
    current: 0,
    total: games.length,
    currentGame: '',
    imported: 0,
    updated: 0,
    skipped: 0
  });

  try {
    for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
      const eaGame = games[gameIndex];
      const gameName = eaGame.title;
      const normalizedName = normalizeEaGameName(gameName);

      // Update progress before processing each game
      await updateProgress(userId, {
        status: 'processing',
        current: gameIndex + 1,
        total: games.length,
        currentGame: gameName,
        imported: results.imported,
        updated: results.updated,
        skipped: results.skipped
      });

      try {
        // Search for game in IGDB if configured
        let cachedGame = null;
        let gameId = null;
        let igdbId = null;

        if (igdbEnabled) {
          try {
            cachedGame = await searchAndCacheGame(normalizedName, 'PC');
            if (cachedGame) {
              gameId = cachedGame._id;
              igdbId = cachedGame.igdbId;
            }
          } catch (error) {
            console.warn(`IGDB search failed for "${gameName}":`, error.message);
          }
        }

        // Skip games not found in IGDB
        if (igdbEnabled && !gameId) {
          results.skipped++;
          results.games.push({ name: gameName, action: 'skipped', reason: 'Not found in game database' });
          continue;
        }

        // Check for duplicate by gameId or igdbId
        let existing = null;
        if (gameId) {
          existing = await CollectionItems.findOneAsync({ userId, gameId });
        }
        if (!existing && igdbId) {
          existing = await CollectionItems.findOneAsync({ userId, igdbId });
        }

        // Prepare playtime data
        const hoursPlayed = importPlaytime ? eaGame.hoursPlayed : null;

        if (existing) {
          if (updateExisting) {
            // Merge platforms: add PC if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes('PC')
              ? existingPlatforms
              : [...existingPlatforms, 'PC'];

            // Merge storefronts: add origin if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('origin')
              ? existingStorefronts
              : [...existingStorefronts, 'origin'];

            const updateFields = {
              platforms: mergedPlatforms,
              storefronts: mergedStorefronts,
              updatedAt: new Date()
            };

            // Update playtime if importing and greater than existing
            if (importPlaytime && hoursPlayed !== null) {
              if (!existing.hoursPlayed || hoursPlayed > existing.hoursPlayed) {
                updateFields.hoursPlayed = hoursPlayed;
              }
            }

            await CollectionItems.updateAsync(existing._id, { $set: updateFields });

            results.updated++;
            results.games.push({ name: gameName, matchedName: cachedGame?.title || null, action: 'updated' });
          } else {
            results.skipped++;
            results.games.push({ name: gameName, action: 'skipped', reason: 'Already in collection' });
          }
          continue;
        }

        // Create new collection item
        const collectionItem = {
          userId,
          platforms: ['PC'],
          storefronts: ['origin'],
          status: 'backlog',
          favorite: false,
          hoursPlayed: hoursPlayed,
          rating: null,
          notes: '',
          physical: false,
          dateAdded: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Only set gameId/igdbId if found
        if (gameId) {
          collectionItem.gameId = gameId;
          collectionItem.game = buildEmbeddedGame(cachedGame);
        }
        if (igdbId) {
          collectionItem.igdbId = igdbId;
        }

        await CollectionItems.insertAsync(collectionItem);

        results.imported++;
        results.games.push({ name: gameName, matchedName: cachedGame?.title || null, action: 'imported' });
      } catch (error) {
        results.skipped++;
        results.errors.push({
          name: gameName,
          error: error.message
        });
        results.games.push({ name: gameName, action: 'error', reason: error.message });
      }
    }

    // Mark as complete
    await updateProgress(userId, {
      status: 'complete',
      current: games.length,
      total: games.length,
      currentGame: '',
      imported: results.imported,
      updated: results.updated,
      skipped: results.skipped
    });
  } catch (error) {
    // Mark as error
    await updateProgress(userId, {
      status: 'error',
      error: error.message
    });
    throw error;
  }

  return results;
}
