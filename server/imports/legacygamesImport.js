import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

const LEGACY_GAMES_API_BASE = 'https://api.legacygames.com';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Build auth headers for Legacy Games API
function buildHeaders(email, password) {
  const encoded = Buffer.from(`${email}:${password}`).toString('base64');
  return {
    'usertoken': `Basic ${encoded}`,
    'authorization': '?token?',
    'accept': 'application/json',
    'content-type': 'application/json'
  };
}

// Fetch with retry logic
async function fetchWithRetry(url, options = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', `Could not connect to Legacy Games. Please try again later. (${lastError?.message || 'Unknown error'})`);
}

// Login and get userId
async function login(headers) {
  const response = await fetchWithRetry(`${LEGACY_GAMES_API_BASE}/users/login`, {
    method: 'GET',
    headers
  });

  if (response.status === 401 || response.status === 403) {
    throw new Meteor.Error('auth-invalid', 'Invalid email or password.');
  }

  if (!response.ok) {
    throw new Meteor.Error('auth-invalid', `Legacy Games login failed (${response.status}).`);
  }

  const data = await response.json();
  const userId = data?.data?.userId;

  if (!userId) {
    throw new Meteor.Error('auth-invalid', 'Invalid email or password.');
  }

  return userId;
}

// Get user profile to retrieve email
async function getProfile(headers, userId) {
  const response = await fetchWithRetry(`${LEGACY_GAMES_API_BASE}/users/profile?userId=${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw new Meteor.Error('api-error', `Failed to fetch Legacy Games profile (${response.status}).`);
  }

  const data = await response.json();
  const email = data?.data?.email;

  if (!email) {
    throw new Meteor.Error('api-error', 'Could not retrieve email from Legacy Games profile.');
  }

  return email;
}

// Get full product catalog
async function getCatalog(headers) {
  const response = await fetchWithRetry(`${LEGACY_GAMES_API_BASE}/products/catalog`, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw new Meteor.Error('api-error', `Failed to fetch Legacy Games catalog (${response.status}).`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : (data?.data || []);
}

// Get purchased product IDs
async function getDownloads(headers, userId) {
  const response = await fetchWithRetry(`${LEGACY_GAMES_API_BASE}/users/downloads?userId=${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw new Meteor.Error('api-error', `Failed to fetch Legacy Games downloads (${response.status}).`);
  }

  const data = await response.json();
  const downloads = data?.data || [];
  return downloads.map(download => download.product_id);
}

// Get giveaway games
async function getGiveaways(headers, email) {
  const response = await fetchWithRetry(`${LEGACY_GAMES_API_BASE}/users/getgiveawaycatalogbyemail?email=${encodeURIComponent(email)}`, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw new Meteor.Error('api-error', `Failed to fetch Legacy Games giveaways (${response.status}).`);
  }

  const data = await response.json();
  const giveawayProducts = data?.data || [];

  // Extract individual games from each giveaway product
  const games = [];
  for (const product of giveawayProducts) {
    const productGames = product.games || [];
    for (const game of productGames) {
      if (game.game_name) {
        games.push(game);
      }
    }
  }

  return games;
}

// Normalize Legacy Games game name for better IGDB matching
function normalizeLegacyGamesName(name) {
  let normalized = name;

  // Strip trademark symbols
  normalized = normalized.replace(/[™®©]/g, '');

  // Expand common abbreviations
  normalized = normalized.replace(/\bCE\b/g, "Collector's Edition");

  // Remove common edition suffixes for better matching
  normalized = normalized.replace(/\s*[-–—:]\s*(Deluxe|Standard|Ultimate|Gold|Premium|Complete|Game of the Year|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*Edition\s*$/i, '');

  // Remove trailing edition keywords without "Edition" suffix
  normalized = normalized.replace(/\s+(Deluxe|Standard|Ultimate|Gold|Premium|Complete|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*$/i, '');

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// Deduplicate games by name (case-insensitive)
function deduplicateGames(games) {
  const seen = new Set();
  const unique = [];

  for (const game of games) {
    const key = game.game_name.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(game);
    }
  }

  return unique;
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

// Fetch the full Legacy Games library
async function fetchLegacyGamesLibrary(email, password) {
  const headers = buildHeaders(email, password);

  // 1. Login
  const lgUserId = await login(headers);

  // 2. Get profile email
  const profileEmail = await getProfile(headers, lgUserId);

  // 3. Get full catalog
  const catalog = await getCatalog(headers);

  // 4. Get owned product IDs
  const ownedProductIds = await getDownloads(headers, lgUserId);
  const ownedSet = new Set(ownedProductIds);

  // 5. Filter catalog to owned products, extract games
  const purchasedGames = [];
  for (const product of catalog) {
    if (ownedSet.has(product.product_id)) {
      const productGames = product.games || [];
      for (const game of productGames) {
        if (game.game_name) {
          purchasedGames.push(game);
        }
      }
    }
  }

  // 6. Get giveaway games
  const giveawayGames = await getGiveaways(headers, profileEmail);

  // 7. Combine and deduplicate
  const allGames = deduplicateGames([...purchasedGames, ...giveawayGames]);

  return allGames;
}

// Main import function
export async function importLegacyGamesLibrary(userId, email, password, options = {}) {
  const { updateExisting = true } = options;

  // Fetch library from Legacy Games API
  const allGames = await fetchLegacyGamesLibrary(email, password);

  if (allGames.length === 0) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      games: []
    };
  }

  const results = {
    total: allGames.length,
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
    total: allGames.length,
    currentGame: '',
    imported: 0,
    updated: 0,
    skipped: 0
  });

  try {
    for (let gameIndex = 0; gameIndex < allGames.length; gameIndex++) {
      const legacyGame = allGames[gameIndex];
      const gameName = legacyGame.game_name;
      const normalizedName = normalizeLegacyGamesName(gameName);

      // Update progress before processing each game
      await updateProgress(userId, {
        status: 'processing',
        current: gameIndex + 1,
        total: allGames.length,
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

        if (existing) {
          if (updateExisting) {
            // Merge platforms: add PC if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes('PC')
              ? existingPlatforms
              : [...existingPlatforms, 'PC'];

            // Merge storefronts: add legacygames if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('legacygames')
              ? existingStorefronts
              : [...existingStorefronts, 'legacygames'];

            await CollectionItems.updateAsync(existing._id, {
              $set: {
                platforms: mergedPlatforms,
                storefronts: mergedStorefronts,
                updatedAt: new Date()
              }
            });

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
          storefronts: ['legacygames'],
          status: 'backlog',
          favorite: false,
          hoursPlayed: null,
          rating: null,
          notes: '',
          physical: false,
          dateAdded: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

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
      current: allGames.length,
      total: allGames.length,
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
