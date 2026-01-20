import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { importDarkadiaCSV, previewDarkadiaImport } from '../imports/darkadiaImport.js';
import { exportCollectionCSV, importBacklogBeaconCSV } from '../imports/csvExport.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { findStorefrontByName } from '../../imports/lib/constants/storefronts.js';
import { isConfigured } from '../igdb/client.js';

// Rate limiting for imports
const importRateLimiter = new Map();
const IMPORT_RATE_LIMIT_MS = 60000; // 1 minute between imports

function checkImportRateLimit(userId) {
  const now = Date.now();
  const lastImport = importRateLimiter.get(userId);
  
  if (lastImport && now - lastImport < IMPORT_RATE_LIMIT_MS) {
    const waitSeconds = Math.ceil((IMPORT_RATE_LIMIT_MS - (now - lastImport)) / 1000);
    throw new Meteor.Error('rate-limited', `Please wait ${waitSeconds} seconds before importing again`);
  }
  
  importRateLimiter.set(userId, now);
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
    
    checkImportRateLimit(this.userId);
    
    if (csvContent.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Meteor.Error('file-too-large', 'CSV file is too large (max 10MB)');
    }
    
    const importOptions = {
      updateExisting: options?.updateExisting === true
    };
    
    return importDarkadiaCSV(this.userId, csvContent, importOptions);
  },
  
  // Export collection to CSV
  async 'export.collection'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to export');
    }
    
    return exportCollectionCSV(this.userId);
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
    
    checkImportRateLimit(this.userId);
    
    if (csvContent.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Meteor.Error('file-too-large', 'CSV file is too large (max 10MB)');
    }
    
    const importOptions = {
      updateExisting: options?.updateExisting === true
    };
    
    return importBacklogBeaconCSV(this.userId, csvContent, importOptions);
  },
  
  // Simple import: list of game names with optional storefront
  async 'import.simple'(games) {
    check(games, [{
      name: String,
      platform: Match.Maybe(String),
      storefront: Match.Maybe(String)
    }]);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to import');
    }
    
    checkImportRateLimit(this.userId);
    
    if (games.length > 500) {
      throw new Meteor.Error('too-many-games', 'Cannot import more than 500 games at once');
    }
    
    const results = {
      total: games.length,
      imported: 0,
      skipped: 0,
      errors: []
    };
    
    const igdbEnabled = isConfigured();
    
    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      
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
        
        // Check for duplicate
        const existingQuery = { userId: this.userId };
        if (gameId) {
          existingQuery.gameId = gameId;
        } else {
          existingQuery.gameName = game.name;
        }
        
        const existing = await CollectionItems.findOneAsync(existingQuery);
        
        if (existing) {
          results.skipped++;
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
          gameName: game.name,
          platform: game.platform || '',
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
      } catch (error) {
        results.skipped++;
        results.errors.push({
          name: game.name,
          error: error.message
        });
      }
    }
    
    return results;
  }
});
