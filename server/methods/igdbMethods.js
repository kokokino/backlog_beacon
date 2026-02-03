import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { searchGames, isConfigured, getCoverUrl, sanitizeSearchQuery } from '../igdb/client.js';
import { searchAndCacheGame, getOrFetchGame, refreshStaleGames } from '../igdb/gameCache.js';
import { Games } from '../../imports/lib/collections/games.js';
import { queueCoverDownload, queueMultipleCoverDownloads } from '../covers/coverQueue.js';
import { checkCooldownRateLimit } from '../lib/distributedRateLimit.js';

// Rate limiting (distributed across instances)
const SEARCH_RATE_LIMIT_MS = 500;

async function checkSearchRateLimit(userId) {
  const result = await checkCooldownRateLimit(`igdb-search:${userId}`, SEARCH_RATE_LIMIT_MS);

  if (!result.allowed) {
    throw new Meteor.Error('rate-limited', 'Please wait before searching again');
  }
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
    localCoverId: null,
    localCoverUpdatedAt: null,
    rating: igdbGame.rating || null,
    ratingCount: igdbGame.rating_count || 0,
    aggregatedRating: igdbGame.aggregated_rating || null,
    aggregatedRatingCount: igdbGame.aggregated_rating_count || 0,
    igdbUpdatedAt: igdbGame.updated_at || null,
    igdbChecksum: igdbGame.checksum || null,
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
    
    await checkSearchRateLimit(this.userId);
    
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
    
    await checkSearchRateLimit(this.userId);
    
    if (query.trim().length < 3) {
      return [];
    }
    
    const igdbResults = await searchGames(query, 20);
    
    if (igdbResults.length === 0) {
      return [];
    }
    
    const cachedGames = [];
    const gamesToQueueForCovers = [];
    
    for (const igdbGame of igdbResults) {
      let existingGame = await Games.findOneAsync({ igdbId: igdbGame.id });
      
      if (existingGame) {
        cachedGames.push(existingGame);
        
        // Queue for cover download if game has cover but no local cover yet
        if (existingGame.coverImageId && !existingGame.localCoverId) {
          gamesToQueueForCovers.push(existingGame);
        }
        continue;
      }
      
      const gameData = transformIgdbGameForCache(igdbGame);
      
      try {
        const gameId = await Games.insertAsync(gameData);
        const newGame = await Games.findOneAsync(gameId);
        if (newGame) {
          cachedGames.push(newGame);
          
          // Queue new game for cover download if it has a cover
          if (newGame.coverImageId) {
            gamesToQueueForCovers.push(newGame);
          }
        }
      } catch (error) {
        if (error.message && error.message.includes('duplicate key')) {
          existingGame = await Games.findOneAsync({ igdbId: igdbGame.id });
          if (existingGame) {
            cachedGames.push(existingGame);
            
            // Queue for cover if needed
            if (existingGame.coverImageId && !existingGame.localCoverId) {
              gamesToQueueForCovers.push(existingGame);
            }
          }
        } else {
          console.error('Error caching game:', error);
        }
      }
    }
    
    // Queue cover downloads asynchronously (don't block the response)
    if (gamesToQueueForCovers.length > 0) {
      console.log(`igdb.searchAndCache: Queueing ${gamesToQueueForCovers.length} games for cover download`);
      queueMultipleCoverDownloads(gamesToQueueForCovers, 5).catch(error => {
        console.error('Error queueing cover downloads:', error);
      });
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
    
    // Queue cover download if needed (getOrFetchGame in gameCache.js should handle this,
    // but let's be explicit here too)
    if (game && game.coverImageId && !game.localCoverId) {
      queueCoverDownload(game._id, game.coverImageId, 3).catch(error => {
        console.error('Error queueing cover download:', error);
      });
    }
    
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
    
    // Queue cover download if needed
    if (game && game.coverImageId && !game.localCoverId) {
      queueCoverDownload(game._id, game.coverImageId, 5).catch(error => {
        console.error('Error queueing cover download:', error);
      });
    }
    
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

    const cleanedQuery = sanitizeSearchQuery(query);
    const searchRegex = new RegExp(cleanedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    return Games.find(
      {
        title: searchRegex,
        $or: [
          { ownerId: { $exists: false } },
          { ownerId: null },
          { ownerId: this.userId }
        ]
      },
      {
        limit: 20,
        fields: {
          _id: 1,
          igdbId: 1,
          ownerId: 1,
          title: 1,
          platforms: 1,
          genres: 1,
          releaseYear: 1,
          coverUrl: 1,
          coverImageId: 1,
          igdbCoverUrl: 1,
          localCoverId: 1,
          localCoverUrl: 1,
          developer: 1
        }
      }
    ).fetchAsync();
  }
});
