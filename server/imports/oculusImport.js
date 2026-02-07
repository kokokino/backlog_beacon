import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// Oculus/Meta GraphQL API endpoint
const OCULUS_GRAPHQL_URL = 'https://graph.oculus.com/graphql?locale=en_US';

// Platform-specific doc_ids and entitlement fields (from Playnite extension)
const PLATFORM_CONFIG = {
  quest: {
    docId: '6260775224011087',
    entitlementField: 'active_android_entitlements',
    platformName: 'Meta Quest'
  },
  rift: {
    docId: '6549375561785664',
    entitlementField: 'active_pc_entitlements',
    platformName: 'PC VR'
  },
  go: {
    docId: '6040003812794294',
    entitlementField: 'active_android_entitlements',
    platformName: 'Oculus Go'
  }
};

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
        console.log(`Oculus API rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
        lastError = new Error('Oculus API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (response.status === 400 || response.status === 401) {
        throw new Meteor.Error('auth-invalid', 'Access token is invalid or expired. Please get a new token from Meta.');
      }

      if (!response.ok) {
        throw new Error(`Oculus API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      // Re-throw Meteor errors immediately
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(`Oculus API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', 'Could not connect to Meta/Oculus. Please try again later.');
}

// Fetch library from Oculus GraphQL API
async function fetchOculusLibrary(accessToken, platform) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    throw new Meteor.Error('invalid-platform', `Unknown platform: ${platform}`);
  }

  const body = new URLSearchParams({
    access_token: accessToken,
    doc_id: config.docId,
    variables: '{}'
  });

  const response = await fetchWithRetry(OCULUS_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const data = await response.json();

  // Check for GraphQL errors
  if (data.errors && data.errors.length > 0) {
    const error = data.errors[0];
    if (error.message?.includes('OAuthException') || error.code === 190) {
      throw new Meteor.Error('auth-invalid', 'Access token is invalid or expired. Please get a new token from Meta.');
    }
    throw new Meteor.Error('api-error', `Oculus API error: ${error.message || 'Unknown error'}`);
  }

  // Extract entitlements from the response
  const entitlements = data?.data?.viewer?.user?.[config.entitlementField]?.edges || [];

  return entitlements.map(edge => edge.node?.item).filter(Boolean);
}

// Filter library items to only include actual games
function filterLibraryItems(items) {
  return items.filter(item => {
    // Must have an id and display_name
    if (!item.id || !item.display_name) {
      return false;
    }

    // Filter out unreleased items
    if (item.is_released === false) {
      return false;
    }

    return true;
  });
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
export async function importOculusLibrary(userId, accessToken, platform, options = {}) {
  const { updateExisting = true } = options;

  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    throw new Meteor.Error('invalid-platform', `Unknown platform: ${platform}. Must be 'quest', 'rift', or 'go'.`);
  }

  // Fetch library from Oculus API
  const allItems = await fetchOculusLibrary(accessToken, platform);

  // Filter to only include actual games
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

  // Build games array
  const games = gameItems.map(item => ({
    title: item.display_name,
    oculusId: item.id,
    platform: config.platformName
  }));

  // Sort alphabetically for consistent UX
  games.sort((a, b) => a.title.localeCompare(b.title));

  // Process the import
  return processOculusImport(userId, games, { updateExisting, platformName: config.platformName });
}

// Process import - following Epic/Amazon patterns
async function processOculusImport(userId, games, options) {
  const { updateExisting, platformName } = options;

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
      const oculusGame = games[gameIndex];
      const gameName = oculusGame.title;

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
            cachedGame = await searchAndCacheGame(gameName, platformName);
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
            // Merge platforms: add VR platform if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes(platformName)
              ? existingPlatforms
              : [...existingPlatforms, platformName];

            // Merge storefronts: add oculus if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('oculus')
              ? existingStorefronts
              : [...existingStorefronts, 'oculus'];

            const updateFields = {
              platforms: mergedPlatforms,
              storefronts: mergedStorefronts,
              updatedAt: new Date()
            };

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
          platforms: [platformName],
          storefronts: ['oculus'],
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
