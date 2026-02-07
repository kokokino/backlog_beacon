import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

const RA_API_BASE = 'https://retroachievements.org/API';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const PAGE_SIZE = 500;
const PAGE_DELAY_MS = 200;

// Map RA dual-name consoles to clean platform strings for IGDB matching
const RA_PLATFORM_MAP = {
  'Mega Drive/Genesis': 'Genesis',
  'SNES/Super Famicom': 'SNES',
  'NES/Famicom': 'NES',
  'PC Engine/TurboGrafx-16': 'TurboGrafx-16',
  'PC Engine CD/TurboGrafx-CD': 'TurboGrafx-CD'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapPlatform(consoleName) {
  return RA_PLATFORM_MAP[consoleName] || consoleName;
}

// Determine collection status from RA achievement data
function mapStatus(game) {
  const kind = game.HighestAwardKind;

  if (kind === 'mastered' || kind === 'completed') {
    return 'completed';
  }

  if (kind === 'beaten-hardcore' || kind === 'beaten-softcore') {
    return 'completed';
  }

  if (game.NumAwarded > 0) {
    return 'playing';
  }

  return 'backlog';
}

// Fetch with retry logic
async function fetchWithRetry(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
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

  throw new Meteor.Error('network-error', `Could not connect to RetroAchievements. Please try again later. (${lastError?.message || 'Unknown error'})`);
}

// Validate user exists by fetching profile
async function validateUser(username, apiKey) {
  const url = `${RA_API_BASE}/API_GetUserProfile.php?u=${encodeURIComponent(username)}&y=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithRetry(url);

  if (response.status === 401 || response.status === 403) {
    throw new Meteor.Error('auth-invalid', 'Invalid username or API key.');
  }

  if (!response.ok) {
    throw new Meteor.Error('auth-invalid', `RetroAchievements API error (${response.status}).`);
  }

  const data = await response.json();

  if (!data || !data.User) {
    throw new Meteor.Error('auth-invalid', 'Invalid username or API key.');
  }

  return data;
}

// Fetch all games with completion progress (paginated)
async function fetchCompletionProgress(username, apiKey) {
  const allGames = [];
  let offset = 0;
  let total = null;

  while (true) {
    const url = `${RA_API_BASE}/API_GetUserCompletionProgress.php?u=${encodeURIComponent(username)}&y=${encodeURIComponent(apiKey)}&c=${PAGE_SIZE}&o=${offset}`;
    const response = await fetchWithRetry(url);

    if (response.status === 401 || response.status === 403) {
      throw new Meteor.Error('auth-invalid', 'Invalid username or API key.');
    }

    if (!response.ok) {
      throw new Meteor.Error('api-error', `Failed to fetch game list (${response.status}).`);
    }

    const data = await response.json();

    if (total === null) {
      total = data.Total || 0;
    }

    const results = data.Results || [];
    allGames.push(...results);

    if (allGames.length >= total || results.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
    await sleep(PAGE_DELAY_MS);
  }

  return allGames;
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
export async function importRetroAchievementsLibrary(userId, username, apiKey, options = {}) {
  const { updateExisting = true } = options;

  // Validate credentials
  await validateUser(username, apiKey);

  // Fetch full library
  const allGames = await fetchCompletionProgress(username, apiKey);

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
      const raGame = allGames[gameIndex];
      const gameName = raGame.Title;
      const platform = mapPlatform(raGame.ConsoleName);
      const status = mapStatus(raGame);

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
            cachedGame = await searchAndCacheGame(gameName, platform);
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
            // Merge platforms: add this platform if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes(platform)
              ? existingPlatforms
              : [...existingPlatforms, platform];

            await CollectionItems.updateAsync(existing._id, {
              $set: {
                platforms: mergedPlatforms,
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
          platforms: [platform],
          storefronts: [],
          status,
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
