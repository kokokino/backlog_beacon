import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserTitles,
  getUserPlayedGames
} from 'psn-api';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

// Sleep helper for retry logic
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Normalize PSN game name for better IGDB matching
function normalizePsnGameName(name) {
  let normalized = name;

  // Strip trademark symbols
  normalized = normalized.replace(/[™®©]/g, '');

  // Remove platform suffixes like (PS4), (PS5), (PS3), (PS Vita)
  normalized = normalized.replace(/\s*\(PS[345]\)\s*$/i, '');
  normalized = normalized.replace(/\s*\(PS Vita\)\s*$/i, '');
  normalized = normalized.replace(/\s*\(PlayStation®?[345]\)\s*$/i, '');

  // Remove common edition suffixes for better matching
  normalized = normalized.replace(/\s*[-–—:]\s*(Deluxe|Standard|Ultimate|Gold|Premium|Complete|Game of the Year|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*Edition\s*$/i, '');

  // Remove trailing edition words without "Edition"
  normalized = normalized.replace(/\s+(Deluxe|Standard|Ultimate|Gold|Premium|Complete|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*$/i, '');

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// Map PSN platform strings to platform names used in our system
function mapTrophyPlatform(platform) {
  const platformMap = {
    'PS3': 'PS3',
    'PS4': 'PS4',
    'PS5': 'PS5',
    'PSVITA': 'PS Vita',
    'PS Vita': 'PS Vita'
  };

  return platformMap[platform] || platform;
}

// Parse ISO 8601 duration (e.g. PT234H15M7S) to hours
function parseIsoDuration(duration) {
  if (!duration) {
    return null;
  }

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) {
    return null;
  }

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  const totalHours = hours + (minutes / 60) + (seconds / 3600);

  // Round to 1 decimal place
  return Math.round(totalHours * 10) / 10;
}

// Normalize name for dedup comparison
function normalizeForDedup(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
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

// Authenticate with PSN using NPSSO token
async function authenticatePsn(npssoToken) {
  try {
    const accessCode = await exchangeNpssoForAccessCode(npssoToken);
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
    return authorization;
  } catch (error) {
    throw new Meteor.Error('auth-invalid', 'NPSSO token is invalid or expired. Please get a new token from playstation.com.');
  }
}

// Fetch all trophy titles with pagination (covers PS3, PS4, PS5, PS Vita)
async function fetchTrophyTitles(authorization) {
  const allTitles = [];
  let offset = 0;
  const limit = 800;

  for (let page = 0; page < 20; page++) {
    try {
      const response = await getUserTitles(
        { accessToken: authorization.accessToken },
        'me',
        { limit, offset }
      );

      const titles = response.trophyTitles || [];
      allTitles.push(...titles);

      // If we got fewer than the limit, we've reached the end
      if (titles.length < limit) {
        break;
      }

      offset += limit;
      await sleep(500); // Rate limit between pages
    } catch (error) {
      if (error instanceof Meteor.Error) {
        throw error;
      }
      console.warn(`Failed to fetch PSN trophy titles page ${page}:`, error.message);
      break;
    }
  }

  return allTitles;
}

// Fetch played games with playtime data (PS4/PS5 only)
async function fetchPlayedGames(authorization) {
  const allGames = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < 20; page++) {
    try {
      const response = await getUserPlayedGames(
        { accessToken: authorization.accessToken },
        'me',
        { limit, offset }
      );

      const games = response.titles || [];
      allGames.push(...games);

      // If we got fewer than the limit, we've reached the end
      if (games.length < limit) {
        break;
      }

      offset += limit;
      await sleep(500); // Rate limit between pages
    } catch (error) {
      console.warn(`Failed to fetch PSN played games page ${page}:`, error.message);
      break;
    }
  }

  return allGames;
}

// Merge trophy titles and played games into a deduplicated list
function mergeAndDedup(trophyTitles, playedGames) {
  const gameMap = new Map(); // normalizedName -> game entry

  // Process trophy titles first (covers PS3, PS4, PS5, PS Vita)
  for (const title of trophyTitles) {
    if (!title.trophyTitleName) {
      continue;
    }

    const name = title.trophyTitleName;
    const dedupKey = normalizeForDedup(name);
    const platform = mapTrophyPlatform(title.trophyTitlePlatform || 'PS4');

    if (gameMap.has(dedupKey)) {
      // Merge platform into existing entry
      const existing = gameMap.get(dedupKey);
      if (!existing.platforms.includes(platform)) {
        existing.platforms.push(platform);
      }
    } else {
      gameMap.set(dedupKey, {
        title: name,
        platforms: [platform],
        hoursPlayed: null
      });
    }
  }

  // Process played games (adds PS4/PS5 titles not in trophy list, and playtime)
  for (const game of playedGames) {
    if (!game.name) {
      continue;
    }

    const name = game.name;
    const dedupKey = normalizeForDedup(name);
    const platform = game.category === 'ps5_native_game' ? 'PS5' : 'PS4';
    const hoursPlayed = parseIsoDuration(game.playDuration);

    if (gameMap.has(dedupKey)) {
      // Update existing entry with playtime and possibly new platform
      const existing = gameMap.get(dedupKey);
      if (!existing.platforms.includes(platform)) {
        existing.platforms.push(platform);
      }
      // Use playtime from played games if available
      if (hoursPlayed !== null && (existing.hoursPlayed === null || hoursPlayed > existing.hoursPlayed)) {
        existing.hoursPlayed = hoursPlayed;
      }
    } else {
      gameMap.set(dedupKey, {
        title: name,
        platforms: [platform],
        hoursPlayed
      });
    }
  }

  // Convert to array and sort by playtime (most played first)
  const games = Array.from(gameMap.values());
  games.sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0));

  return games;
}

// Main import function
export async function importPsnLibrary(userId, npssoToken, options = {}) {
  const { updateExisting = true, importPlaytime = true } = options;

  // Step 1: Authenticate with PSN
  const authorization = await authenticatePsn(npssoToken);

  // Step 2: Fetch trophy titles (PS3, PS4, PS5, PS Vita)
  const trophyTitles = await fetchTrophyTitles(authorization);

  // Step 3: Fetch played games (PS4/PS5 with playtime)
  let playedGames = [];
  try {
    playedGames = await fetchPlayedGames(authorization);
  } catch (error) {
    console.warn('Failed to fetch PSN played games (continuing with trophy titles only):', error.message);
  }

  // Step 4: Merge and deduplicate
  const games = mergeAndDedup(trophyTitles, playedGames);

  if (games.length === 0) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      games: []
    };
  }

  // Step 5: Process the import
  return processPsnImport(userId, games, { updateExisting, importPlaytime });
}

// Process import - following EA/Xbox patterns
async function processPsnImport(userId, games, options) {
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
      const psnGame = games[gameIndex];
      const gameName = psnGame.title;
      const normalizedName = normalizePsnGameName(gameName);
      const searchPlatform = psnGame.platforms[0] || 'PS4';

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
            cachedGame = await searchAndCacheGame(normalizedName, searchPlatform);
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
        const hoursPlayed = importPlaytime ? psnGame.hoursPlayed : null;

        if (existing) {
          if (updateExisting) {
            // Merge platforms
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = [...new Set([...existingPlatforms, ...psnGame.platforms])];

            // Merge storefronts
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('playstation')
              ? existingStorefronts
              : [...existingStorefronts, 'playstation'];

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
          platforms: psnGame.platforms,
          storefronts: ['playstation'],
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
