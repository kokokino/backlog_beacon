import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { searchGames, isConfigured, getCoverUrl } from '../igdb/client.js';
import { searchAndCacheGame, getOrFetchGame, refreshStaleGames } from '../igdb/gameCache.js';
import { Games } from '../../imports/lib/collections/games.js';

// Rate limiting
const searchRateLimiter = new Map();
const SEARCH_RATE_LIMIT_MS = 500;

function checkSearchRateLimit(userId) {
  const now = Date.now();
  const lastSearch = searchRateLimiter.get(userId);
  
  if (lastSearch && now - lastSearch < SEARCH_RATE_LIMIT_MS) {
    throw new Meteor.Error('rate-limited', 'Please wait before searching again');
  }
  
  searchRateLimiter.set(userId, now);
}

function transformIgdbGameForCache(igdbGame) {
  const developers = igdbGame.involved_companies?.filter(ic => ic.developer) || [];
  const publishers = igdbGame.involved_companies?.filter(ic => ic.publisher) || [];
  
  const releaseDate = igdbGame.first_release_date 
    ? new Date(igdbGame.first_release_date * 1000) 
    : null;
  
  return {
    igdbId: igdbGame.id,
    title: igdbGame.name,
    name: igdbGame.name,
    slug: igdbGame.slug,
    summary: igdbGame.summary || '',
    storyline: igdbGame.storyline || '',
    platforms: igdbGame.platforms?.map(p => p.name) || [],
    platformIds: igdbGame.platforms?.map(p => p.id) || [],
    genres: igdbGame.genres?.map(g => g.name) || [],
    genreIds: igdbGame.genres?.map(g => g.id) || [],
    themes: [],
    releaseDate: releaseDate,
    releaseYear: releaseDate ? releaseDate.getFullYear() : null,
    developer: developers[0]?.company?.name || '',
    developerIds: developers.map(d => d.company?.id).filter(Boolean),
    publisher: publishers[0]?.company?.name || '',
    publisherIds: publishers.map(p => p.company?.id).filter(Boolean),
    coverImageId: igdbGame.cover?.image_id || null,
    igdbCoverUrl: igdbGame.cover?.image_id ? getCoverUrl(igdbGame.cover.image_id) : null,
    rating: igdbGame.rating || null,
    ratingCount: igdbGame.rating_count || 0,
    aggregatedRating: igdbGame.aggregated_rating || null,
    aggregatedRatingCount: igdbGame.aggregated_rating_count || 0,
    igdbUpdatedAt: igdbGame.updated_at || null,
    igdbChecksum: igdbGame.checksum || null,
    searchName: igdbGame.name.toLowerCase(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

Meteor.methods({
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
  
  async 'igdb.searchAndCache'(query) {
    check(query, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to search');
    }
    
    if (!isConfigured()) {
      throw new Meteor.Error('igdb-not-configured', 'IGDB is not configured');
    }
    
    checkSearchRateLimit(this.userId);
    
    if (query.trim().length < 3) {
      return [];
    }
    
    const igdbResults = await searchGames(query, 20);
    
    if (igdbResults.length === 0) {
      return [];
    }
    
    const cachedGames = [];
    
    for (const igdbGame of igdbResults) {
      let existingGame = await Games.findOneAsync({ igdbId: igdbGame.id });
      
      if (existingGame) {
        cachedGames.push(existingGame);
        continue;
      }
      
      const gameData = transformIgdbGameForCache(igdbGame);
      
      try {
        const gameId = await Games.insertAsync(gameData);
        const newGame = await Games.findOneAsync(gameId);
        if (newGame) {
          cachedGames.push(newGame);
        }
      } catch (error) {
        if (error.message && error.message.includes('duplicate key')) {
          existingGame = await Games.findOneAsync({ igdbId: igdbGame.id });
          if (existingGame) {
            cachedGames.push(existingGame);
          }
        } else {
          console.error('Error caching game:', error);
        }
      }
    }
    
    return cachedGames;
  },
  
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
  
  async 'igdb.findGame'(name, platform) {
    check(name, String);
    check(platform, Match.Maybe(String));
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    if (!isConfigured()) {
      return null;
    }
    
    const game = await searchAndCacheGame(name, platform);
    
    return game;
  },
  
  'igdb.isConfigured'() {
    return isConfigured();
  },
  
  async 'admin.refreshGameData'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    if (!isConfigured()) {
      throw new Meteor.Error('igdb-not-configured', 'IGDB is not configured');
    }
    
    const result = await refreshStaleGames();
    
    return result;
  },
  
  async 'games.getById'(gameId) {
    check(gameId, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    
    return Games.findOneAsync(gameId);
  },
  
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
