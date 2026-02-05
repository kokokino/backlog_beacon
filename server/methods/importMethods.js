import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { importDarkadiaCSV, previewDarkadiaImport, clearProgress } from '../imports/darkadiaImport.js';
import { exportCollectionCSV, importBacklogBeaconCSV, previewBacklogBeaconImport } from '../imports/csvExport.js';
import { previewSteamLibrary, importSteamLibrary, clearStorefrontProgress, isSteamConfigured } from '../imports/steamImport.js';
import {
  previewGogLibrary,
  previewGogLibraryWithAuth,
  importGogLibrary,
  importGogLibraryWithAuth,
  clearGogProgress
} from '../imports/gogImport.js';
import { importEpicLibrary } from '../imports/epicImport.js';
import { importAmazonLibrary } from '../imports/amazonImport.js';
import { importOculusLibrary } from '../imports/oculusImport.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { findStorefrontByName } from '../../imports/lib/constants/storefronts.js';
import { isConfigured } from '../igdb/client.js';
import { checkCooldownRateLimit } from '../lib/distributedRateLimit.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// Rate limiting for imports (distributed across instances)
const IMPORT_RATE_LIMIT_MS = 60000; // 1 minute between imports

async function checkImportRateLimit(userId) {
  const result = await checkCooldownRateLimit(`import:${userId}`, IMPORT_RATE_LIMIT_MS);

  if (!result.allowed) {
    const waitSeconds = Math.ceil(result.waitMs / 1000);
    throw new Meteor.Error('rate-limited', `Please wait ${waitSeconds} seconds before importing again`);
  }
}

// Update progress for simple import
async function updateSimpleProgress(userId, progressData) {
  await ImportProgress.upsertAsync(
    { userId, type: 'simple' },
    {
      $set: {
        ...progressData,
        userId,
        type: 'simple',
        updatedAt: new Date()
      }
    }
  );
}

Meteor.methods({
  // Preview Darkadia CSV import
  async 'import.previewDarkadia'(csvContent) {
    check(csvContent, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }
    
    if (csvContent.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Meteor.Error('file-too-large', 'CSV file is too large (max 10MB)');
    }
    
    return previewDarkadiaImport(this.userId, csvContent);
  },
  
  // Import Darkadia CSV
  async 'import.darkadia'(csvContent, options) {
    check(csvContent, String);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean)
    }));
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }
    
    await checkImportRateLimit(this.userId);
    
    if (csvContent.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Meteor.Error('file-too-large', 'CSV file is too large (max 10MB)');
    }
    
    const importOptions = {
      updateExisting: options?.updateExisting === true
    };
    
    // Use this.unblock() to allow other methods to run while import is processing
    this.unblock();
    
    return importDarkadiaCSV(this.userId, csvContent, importOptions);
  },
  
  // Clear import progress
  async 'import.clearProgress'(type) {
    check(type, Match.Maybe(String));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }

    await clearProgress(this.userId, type || 'darkadia');
  },
  
  // Export collection to CSV
  async 'export.collection'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to export');
    }
    
    return exportCollectionCSV(this.userId);
  },
  
  // Preview Backlog Beacon CSV import
  async 'import.previewBacklogBeacon'(csvContent) {
    check(csvContent, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    if (csvContent.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Meteor.Error('file-too-large', 'CSV file is too large (max 10MB)');
    }

    return previewBacklogBeaconImport(this.userId, csvContent);
  },

  // Import Backlog Beacon CSV
  async 'import.backlogBeacon'(csvContent, options) {
    check(csvContent, String);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean)
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    await checkImportRateLimit(this.userId);

    if (csvContent.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Meteor.Error('file-too-large', 'CSV file is too large (max 10MB)');
    }

    const importOptions = {
      updateExisting: options?.updateExisting === true
    };

    // Use this.unblock() to allow other methods to run while import is processing
    this.unblock();

    return importBacklogBeaconCSV(this.userId, csvContent, importOptions);
  },
  
  // Simple import: list of game names with optional storefront
  async 'import.simple'(games, options) {
    check(games, [{
      name: String,
      platform: Match.Maybe(String),
      storefront: Match.Maybe(String)
    }]);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean)
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    await checkImportRateLimit(this.userId);

    if (games.length > 500) {
      throw new Meteor.Error('too-many-games', 'Cannot import more than 500 games at once');
    }

    // Allow other methods to run while import is processing
    this.unblock();

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
    await updateSimpleProgress(this.userId, {
      status: 'processing',
      current: 0,
      total: games.length,
      currentGame: '',
      imported: 0,
      updated: 0,
      skipped: 0
    });

    try {
      for (let i = 0; i < games.length; i++) {
        const game = games[i];

        // Update progress before processing each game
        await updateSimpleProgress(this.userId, {
          status: 'processing',
          current: i + 1,
          total: games.length,
          currentGame: game.name || 'Unknown',
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
              cachedGame = await searchAndCacheGame(game.name, game.platform);
              if (cachedGame) {
                gameId = cachedGame._id;
                igdbId = cachedGame.igdbId;
              }
            } catch (error) {
              console.warn(`IGDB search failed for "${game.name}":`, error.message);
            }
          }

          // Check for duplicate by gameId or igdbId
          let existing = null;
          if (gameId) {
            existing = await CollectionItems.findOneAsync({ userId: this.userId, gameId });
          }
          if (!existing && igdbId) {
            existing = await CollectionItems.findOneAsync({ userId: this.userId, igdbId });
          }

          if (existing) {
            if (options?.updateExisting === true) {
              // Merge platforms
              const existingPlatforms = existing.platforms || [];
              const newPlatform = game.platform && game.platform.trim() ? [game.platform.trim()] : [];
              const mergedPlatforms = [...new Set([...existingPlatforms, ...newPlatform])].filter(Boolean);

              // Merge storefronts: add new storefront if not already present
              const existingStorefronts = existing.storefronts || [];
              let mergedStorefronts = [...existingStorefronts];
              if (game.storefront) {
                const storefront = findStorefrontByName(game.storefront);
                if (storefront && !mergedStorefronts.includes(storefront.id)) {
                  mergedStorefronts.push(storefront.id);
                }
              }

              await CollectionItems.updateAsync(existing._id, {
                $set: {
                  platforms: mergedPlatforms,
                  storefronts: mergedStorefronts,
                  updatedAt: new Date()
                }
              });

              results.updated++;
              results.games.push({ name: game.name, action: 'updated' });
            } else {
              results.skipped++;
              results.games.push({ name: game.name, action: 'skipped', reason: 'Already in collection' });
            }
            continue;
          }

          // Parse storefront
          const storefronts = [];
          if (game.storefront) {
            const storefront = findStorefrontByName(game.storefront);
            if (storefront) {
              storefronts.push(storefront.id);
            }
          }

          // Create collection item
          await CollectionItems.insertAsync({
            userId: this.userId,
            gameId: gameId,
            igdbId: igdbId,
            game: buildEmbeddedGame(cachedGame),
            platforms: game.platform ? [game.platform] : [],
            storefronts: storefronts,
            status: 'backlog',
            favorite: false,
            hoursPlayed: null,
            rating: null,
            notes: '',
            physical: false,
            dateAdded: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          });

          results.imported++;
          results.games.push({ name: game.name, action: 'imported' });
        } catch (error) {
          results.skipped++;
          results.errors.push({
            name: game.name,
            error: error.message
          });
          results.games.push({ name: game.name, action: 'error', reason: error.message });
        }
      }

      // Mark as complete
      await updateSimpleProgress(this.userId, {
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
      await updateSimpleProgress(this.userId, {
        status: 'error',
        error: error.message
      });
      throw error;
    }

    return results;
  },

  // Preview storefront import (Steam, GOG, etc.)
  async 'import.previewStorefront'(storefront, username) {
    check(storefront, String);
    check(username, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    if (storefront === 'steam') {
      if (!isSteamConfigured()) {
        throw new Meteor.Error('steam-not-configured', 'Steam import is not configured. Please contact support.');
      }
      return previewSteamLibrary(username);
    }

    if (storefront === 'gog') {
      return previewGogLibrary(username);
    }

    throw new Meteor.Error('invalid-storefront', `Unknown storefront: ${storefront}`);
  },

  // Import from storefront (Steam, GOG, etc.)
  async 'import.storefront'(storefront, username, options) {
    check(storefront, String);
    check(username, String);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean),
      importPlaytime: Match.Maybe(Boolean),
      importLastPlayed: Match.Maybe(Boolean)
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    await checkImportRateLimit(this.userId);

    // Use this.unblock() to allow other methods to run while import is processing
    this.unblock();

    if (storefront === 'steam') {
      if (!isSteamConfigured()) {
        throw new Meteor.Error('steam-not-configured', 'Steam import is not configured. Please contact support.');
      }
      const importOptions = {
        updateExisting: options?.updateExisting !== false,
        importPlaytime: options?.importPlaytime !== false,
        importLastPlayed: options?.importLastPlayed !== false
      };
      return importSteamLibrary(this.userId, username, importOptions);
    }

    if (storefront === 'gog') {
      const importOptions = {
        updateExisting: options?.updateExisting !== false,
        importPlaytime: options?.importPlaytime !== false,
        importLastPlayed: options?.importLastPlayed !== false
      };
      return importGogLibrary(this.userId, username, importOptions);
    }

    throw new Meteor.Error('invalid-storefront', `Unknown storefront: ${storefront}`);
  },

  // Clear storefront import progress
  async 'import.clearStorefrontProgress'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }

    await clearStorefrontProgress(this.userId);
  },

  // Preview GOG library using authenticated session
  async 'import.previewGogAuth'(sessionCookie) {
    check(sessionCookie, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    return previewGogLibraryWithAuth(sessionCookie);
  },

  // Import GOG library using authenticated session
  async 'import.gogAuth'(sessionCookie, options) {
    check(sessionCookie, String);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean)
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    await checkImportRateLimit(this.userId);

    // Use this.unblock() to allow other methods to run while import is processing
    this.unblock();

    const importOptions = {
      updateExisting: options?.updateExisting !== false
    };

    return importGogLibraryWithAuth(this.userId, sessionCookie, importOptions);
  },

  // Import Epic Games Store library using authorization code
  async 'import.epic'(authCode, options) {
    check(authCode, String);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean),
      importPlaytime: Match.Maybe(Boolean)
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    await checkImportRateLimit(this.userId);

    // Use this.unblock() to allow other methods to run while import is processing
    this.unblock();

    const importOptions = {
      updateExisting: options?.updateExisting !== false,
      importPlaytime: options?.importPlaytime !== false
    };

    return importEpicLibrary(this.userId, authCode, importOptions);
  },

  // Import Amazon Games library using authorization code and PKCE
  async 'import.amazon'(authCode, codeVerifier, deviceSerial, options) {
    check(authCode, String);
    check(codeVerifier, String);
    check(deviceSerial, String);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean)
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    await checkImportRateLimit(this.userId);

    // Use this.unblock() to allow other methods to run while import is processing
    this.unblock();

    const importOptions = {
      updateExisting: options?.updateExisting !== false
    };

    return importAmazonLibrary(this.userId, authCode, codeVerifier, deviceSerial, importOptions);
  },

  // Import Oculus/Meta library using session cookie
  async 'import.oculus'(accessToken, platform, options) {
    check(accessToken, String);
    check(platform, String);
    check(options, Match.Maybe({
      updateExisting: Match.Maybe(Boolean)
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }

    // Validate platform
    const validPlatforms = ['quest', 'rift', 'go'];
    if (!validPlatforms.includes(platform)) {
      throw new Meteor.Error('invalid-platform', `Platform must be one of: ${validPlatforms.join(', ')}`);
    }

    await checkImportRateLimit(this.userId);

    // Use this.unblock() to allow other methods to run while import is processing
    this.unblock();

    const importOptions = {
      updateExisting: options?.updateExisting !== false
    };

    return importOculusLibrary(this.userId, accessToken, platform, importOptions);
  }
});
