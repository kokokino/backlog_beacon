import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { searchGames, isConfigured, getCoverUrl } from '../igdb/client.js';
import { searchAndCacheGame, getOrFetchGame, refreshStaleGames } from '../igdb/gameCache.js';
import { Games } from '../../imports/lib/collections/games.js';

// Rate limiting
const searchRateLimiter = new Map();
const SEARCH_RATE_LIMIT_MS = 500; // 500ms between searches per user

function checkSearchRateLimit(userId) {
  const now = Date.now();
  const lastSearch = searchRateLimiter.get(userId);
  
  if (lastSearch && now - lastSearch < SEARCH_RATE_LIMIT_MS) {
    throw new Meteor.Error('rate-limited', 'Please wait before searching again');
  }
  
  searchRateLimiter.set(userId, now);
}

Meteor.methods({
  // Search for games via IGDB
  async 'igdb.search'(query) {
    check(query, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to search');
    }
    
    if (!isConfigured()) {
      throw new Meteor.Error('igdb-not-configured', 'IGDB is not configured');
    }
    
    checkSearchRateLimit(this.userId);
    
    if (query.trim().length < 2) {
      return [];
    }
    
    const results = await searchGames(query, 20);
    
    // Transform results for client
    return results.map(game => ({
      igdbId: game.id,
      name: game.name,
      slug: game.slug,
      summary: game.summary,
      coverUrl: game.cover?.image_id ? getCoverUrl(game.cover.image_id, 'cover_small') : null,
      platforms: game.platforms?.map(p => p.name) || [],
      genres: game.genres?.map(g => g.name) || [],
      releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000) : null,
      developer: game.involved_companies?.find(ic => ic.developer)?.company?.name || null
    }));
  },
  
  // Get or fetch a game by IGDB ID
  async 'igdb.getGame'(igdbId) {
    check(igdbId, Number);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    if (!isConfigured()) {
      throw new Meteor.Error('igdb-not-configured', 'IGDB is not configured');
    }
    
    const game = await getOrFetchGame(igdbId);
    
    return game;
  },
  
  // Search and cache a game by name
  async 'igdb.findGame'(name, platform) {
    check(name, String);
    check(platform, Match.Maybe(String));
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    if (!isConfigured()) {
      // Return null if IGDB not configured - allows offline operation
      return null;
    }
    
    const game = await searchAndCacheGame(name, platform);
    
    return game;
  },
  
  // Check if IGDB is configured
  'igdb.isConfigured'() {
    return isConfigured();
  },
  
  // Admin: Refresh stale game data
  async 'admin.refreshGameData'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    // TODO: Add admin check
    
    if (!isConfigured()) {
      throw new Meteor.Error('igdb-not-configured', 'IGDB is not configured');
    }
    
    const result = await refreshStaleGames();
    
    return result;
  },
  
  // Get game from local cache only
  async 'games.getById'(gameId) {
    check(gameId, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    return Games.findOneAsync(gameId);
  },
  
  // Search local game cache
  async 'games.searchLocal'(query) {
    check(query, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    if (query.trim().length < 2) {
      return [];
    }
    
    const searchRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    
    return Games.find(
      { 
        $or: [
          { searchName: searchRegex },
          { title: searchRegex },
          { name: searchRegex }
        ]
      },
      { 
        limit: 20,
        fields: {
          _id: 1,
          igdbId: 1,
          title: 1,
          name: 1,
          platforms: 1,
          genres: 1,
          releaseYear: 1,
          coverUrl: 1,
          coverImageId: 1,
          igdbCoverUrl: 1,
          developer: 1
        }
      }
    ).fetchAsync();
  }
});
