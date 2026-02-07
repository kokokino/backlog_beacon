import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// Normalize Battle.net game name for better IGDB matching
function normalizeBattlenetGameName(name) {
  let normalized = name;

  // Strip trademark symbols
  normalized = normalized.replace(/[™®©]/g, '');

  // Remove common edition suffixes for better matching
  normalized = normalized.replace(/\s*[-–—:]\s*(Deluxe|Standard|Ultimate|Gold|Premium|Complete|Game of the Year|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*Edition\s*$/i, '');

  // Remove trailing edition keywords without "Edition" suffix
  normalized = normalized.replace(/\s+(Deluxe|Standard|Ultimate|Gold|Premium|Complete|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*$/i, '');

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// Parse games from the /api/games-and-subs response
function parseGamesAndSubs(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (error) {
    throw new Meteor.Error('invalid-json', 'Could not parse games JSON. Make sure you copied the entire page content.');
  }

  const gameAccounts = data?.gameAccounts;
  if (!Array.isArray(gameAccounts)) {
    throw new Meteor.Error('invalid-format', 'Unexpected JSON format. Expected a "gameAccounts" array. Make sure you copied from the correct URL.');
  }

  return gameAccounts
    .filter(account => account.localizedGameName)
    .map(account => ({
      name: account.localizedGameName,
      titleId: account.titleId || null
    }));
}

// Parse games from the /api/classic-games response
function parseClassicGames(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (error) {
    throw new Meteor.Error('invalid-json', 'Could not parse classic games JSON. Make sure you copied the entire page content.');
  }

  const classicGames = data?.classicGames;
  if (!Array.isArray(classicGames)) {
    throw new Meteor.Error('invalid-format', 'Unexpected JSON format. Expected a "classicGames" array. Make sure you copied from the correct URL.');
  }

  return classicGames
    .filter(game => game.localizedGameName)
    .map(game => ({
      name: game.localizedGameName,
      titleId: null
    }));
}

// Deduplicate games by normalized name (case-insensitive)
function deduplicateGames(games) {
  const seen = new Set();
  const unique = [];

  for (const game of games) {
    const key = game.name.toLowerCase().replace(/[™®©]/g, '').trim();
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

// Main import function
export async function importBattlenetLibrary(userId, gamesJson, classicGamesJson, options = {}) {
  const { updateExisting = true } = options;

  // Parse main games
  const mainGames = parseGamesAndSubs(gamesJson);

  // Parse classic games if provided
  let classicGames = [];
  if (classicGamesJson) {
    classicGames = parseClassicGames(classicGamesJson);
  }

  // Combine and deduplicate
  const allGames = deduplicateGames([...mainGames, ...classicGames]);

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

  // Process the import
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
      const battlenetGame = allGames[gameIndex];
      const gameName = battlenetGame.name;
      const normalizedName = normalizeBattlenetGameName(gameName);

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

            // Merge storefronts: add battlenet if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('battlenet')
              ? existingStorefronts
              : [...existingStorefronts, 'battlenet'];

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
          storefronts: ['battlenet'],
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
