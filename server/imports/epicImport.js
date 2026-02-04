import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// Epic API endpoints (from Playnite's implementation)
const EPIC_CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a';
const EPIC_CLIENT_SECRET = 'daafbccc737745039dffe53d94fc76cf';
const EPIC_TOKEN_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token';
const EPIC_LIBRARY_URL = 'https://library-service.live.use1a.on.epicgames.com/library/api/public/items';
const EPIC_PLAYTIME_URL = 'https://library-service.live.use1a.on.epicgames.com/library/api/public/playtime/account';
const EPIC_CATALOG_URL = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

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
        console.log(`Epic API rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
        lastError = new Error('Epic API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (response.status === 400 || response.status === 401) {
        throw new Meteor.Error('auth-invalid', 'Authorization code is invalid or expired. Please get a new code from Epic Games.');
      }

      if (!response.ok) {
        throw new Error(`Epic API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      // Re-throw Meteor errors immediately
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(`Epic API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', 'Could not connect to Epic Games. Please try again later.');
}

// Exchange authorization code for access token
async function exchangeCodeForToken(authCode) {
  const credentials = Buffer.from(`${EPIC_CLIENT_ID}:${EPIC_CLIENT_SECRET}`).toString('base64');

  const response = await fetchWithRetry(EPIC_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: `grant_type=authorization_code&code=${encodeURIComponent(authCode)}`
  });

  const data = await response.json();

  if (!data.access_token) {
    throw new Meteor.Error('auth-invalid', 'Failed to get access token from Epic Games.');
  }

  return {
    accessToken: data.access_token,
    accountId: data.account_id
  };
}

// Fetch all library items with cursor-based pagination
async function fetchEpicLibrary(accessToken) {
  const allItems = [];
  let cursor = null;

  do {
    let url = `${EPIC_LIBRARY_URL}?includeMetadata=true`;
    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const response = await fetchWithRetry(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();
    const records = data.records || [];
    allItems.push(...records);

    cursor = data.responseMetadata?.nextCursor || null;
  } while (cursor);

  return allItems;
}

// Filter library items to exclude DLC, UE content, and private items
function filterLibraryItems(items) {
  return items.filter(item => {
    // Exclude Unreal Engine marketplace content
    if (item.namespace === 'ue') {
      return false;
    }

    // Exclude private/sandbox items
    if (item.sandboxType === 'PRIVATE') {
      return false;
    }

    // Exclude DLC (items with mainGameItem set)
    if (item.mainGameItem) {
      return false;
    }

    return true;
  });
}

// Fetch game titles from Epic's catalog API
// Items are grouped by namespace for batch requests
async function fetchGameTitles(accessToken, items) {
  const titleMap = new Map();

  // Group items by namespace
  const itemsByNamespace = new Map();
  for (const item of items) {
    if (!itemsByNamespace.has(item.namespace)) {
      itemsByNamespace.set(item.namespace, []);
    }
    itemsByNamespace.get(item.namespace).push(item.catalogItemId);
  }

  // Fetch titles for each namespace
  for (const [namespace, catalogIds] of itemsByNamespace) {
    try {
      // Epic's catalog endpoint accepts comma-separated IDs
      const idsParam = catalogIds.join(',');
      const url = `${EPIC_CATALOG_URL}/${namespace}/bulk/items?id=${encodeURIComponent(idsParam)}&country=US&locale=en`;

      const response = await fetchWithRetry(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const data = await response.json();

      // Data is keyed by catalogItemId
      for (const [catalogId, itemData] of Object.entries(data)) {
        if (itemData.title) {
          titleMap.set(catalogId, itemData.title);
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch titles for namespace ${namespace}:`, error.message);
      // Continue with other namespaces
    }
  }

  return titleMap;
}

// Fetch playtime data for all games
async function fetchPlaytime(accessToken, accountId) {
  const playtimeMap = new Map();

  try {
    const url = `${EPIC_PLAYTIME_URL}/${accountId}/all`;

    const response = await fetchWithRetry(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    // Data is an array of playtime records
    for (const record of data) {
      if (record.artifactId && record.totalTime) {
        // totalTime is in milliseconds, convert to hours
        const hours = Math.round((record.totalTime / 3600000) * 10) / 10;
        playtimeMap.set(record.artifactId, hours);
      }
    }
  } catch (error) {
    console.warn('Failed to fetch playtime data:', error.message);
    // Playtime is optional, continue without it
  }

  return playtimeMap;
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
export async function importEpicLibrary(userId, authCode, options = {}) {
  const { updateExisting = true, importPlaytime = true } = options;

  // Exchange auth code for access token
  const { accessToken, accountId } = await exchangeCodeForToken(authCode);

  // Fetch library
  const allItems = await fetchEpicLibrary(accessToken);

  // Filter out DLC, UE content, etc.
  const gameItems = filterLibraryItems(allItems);

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

  // Fetch game titles from catalog
  const titleMap = await fetchGameTitles(accessToken, gameItems);

  // Fetch playtime if requested
  let playtimeMap = new Map();
  if (importPlaytime) {
    playtimeMap = await fetchPlaytime(accessToken, accountId);
  }

  // Build games array with titles and playtime
  const games = [];
  for (const item of gameItems) {
    const title = titleMap.get(item.catalogItemId);
    if (!title) {
      // Skip items without titles (couldn't be fetched from catalog)
      continue;
    }

    games.push({
      title,
      appName: item.appName,
      catalogItemId: item.catalogItemId,
      hoursPlayed: playtimeMap.get(item.appName) || null
    });
  }

  // Sort by playtime (most played first) for better UX
  games.sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0));

  // Process the import
  return processEpicImport(userId, games, { updateExisting, importPlaytime });
}

// Process import - common logic shared with GOG import pattern
async function processEpicImport(userId, games, options) {
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
      const epicGame = games[gameIndex];
      const gameName = epicGame.title;

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
            cachedGame = await searchAndCacheGame(gameName, 'PC');
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
        const hoursPlayed = importPlaytime ? epicGame.hoursPlayed : null;

        if (existing) {
          if (updateExisting) {
            // Merge platforms: add PC if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes('PC')
              ? existingPlatforms
              : [...existingPlatforms, 'PC'];

            // Merge storefronts: add epic if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('epic')
              ? existingStorefronts
              : [...existingStorefronts, 'epic'];

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
            results.games.push({ name: gameName, action: 'updated' });
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
          storefronts: ['epic'],
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
        results.games.push({ name: gameName, action: 'imported' });
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
