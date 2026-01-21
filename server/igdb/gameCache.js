import { Meteor } from 'meteor/meteor';
import fs from 'fs';
import { Games } from '../../imports/lib/collections/games.js';
import { getGameById, getGamesByIds, getCoverUrl, findGameByName } from './client.js';
import { queueCoverDownload, CoverQueue, QueueStatus } from '../covers/coverQueue.js';
import { GameCovers } from '../covers/coversCollection.js';

// Transform IGDB game data to our schema
function transformIgdbGame(igdbGame) {
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
    themes: igdbGame.themes?.map(t => t.name) || [],
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
    updatedAt: new Date()
  };
}

// Helper to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Check if a cover file is missing from disk
async function isCoverFileMissing(localCoverId) {
  let isMissing = true;

  if (localCoverId) {
    const coverDoc = await GameCovers.findOneAsync(localCoverId);
    if (coverDoc) {
      const version = coverDoc.versions?.original;
      if (version?.path) {
        isMissing = !fs.existsSync(version.path);
      }
    }
  }

  return isMissing;
}

// Get or fetch a game by IGDB ID
export async function getOrFetchGame(igdbId) {
  // Check local cache first
  let game = await Games.findOneAsync({ igdbId: igdbId });
  
  if (game) {
    return game;
  }
  
  // Fetch from IGDB
  const igdbGame = await getGameById(igdbId);
  
  if (!igdbGame) {
    return null;
  }
  
  // Transform and save
  const gameData = transformIgdbGame(igdbGame);
  gameData.createdAt = new Date();
  
  try {
    const gameId = await Games.insertAsync(gameData);
    const newGame = await Games.findOneAsync(gameId);
    
    // Queue cover download if has cover image
    if (newGame && newGame.coverImageId) {
      queueCoverDownload(newGame._id, newGame.coverImageId, 5).catch(error => {
        console.error('Error queueing cover download:', error);
      });
    }
    
    return newGame;
  } catch (error) {
    // Handle duplicate key error (race condition)
    if (error.message.includes('duplicate key')) {
      return Games.findOneAsync({ igdbId: igdbId });
    }
    throw error;
  }
}

// Get or fetch multiple games by IGDB IDs
export async function getOrFetchGames(igdbIds) {
  if (!igdbIds || igdbIds.length === 0) {
    return [];
  }
  
  // Check which games we already have
  const existingGames = await Games.find({ 
    igdbId: { $in: igdbIds } 
  }).fetchAsync();
  
  const existingIds = new Set(existingGames.map(g => g.igdbId));
  const missingIds = igdbIds.filter(id => !existingIds.has(id));
  
  if (missingIds.length === 0) {
    return existingGames;
  }
  
  // Fetch missing games from IGDB
  const igdbGames = await getGamesByIds(missingIds);
  
  // Transform and save
  const now = new Date();
  const newGames = [];
  
  for (const igdbGame of igdbGames) {
    const gameData = transformIgdbGame(igdbGame);
    gameData.createdAt = now;
    
    try {
      const gameId = await Games.insertAsync(gameData);
      const newGame = await Games.findOneAsync(gameId);
      if (newGame) {
        newGames.push(newGame);
        
        // Queue cover download if has cover image
        if (newGame.coverImageId) {
          queueCoverDownload(newGame._id, newGame.coverImageId, 5).catch(error => {
            console.error('Error queueing cover download:', error);
          });
        }
      }
    } catch (error) {
      // Ignore duplicate key errors (race condition)
      if (!error.message.includes('duplicate key')) {
        console.error('Error inserting game:', error);
      }
    }
  }
  
  // Return all games
  return Games.find({ igdbId: { $in: igdbIds } }).fetchAsync();
}

// Search for a game by name, checking cache first
export async function searchAndCacheGame(name, platform = null) {
  if (!name || name.trim().length === 0) {
    return null;
  }
  
  const searchName = name.toLowerCase().trim();
  
  // Check local cache first (exact match)
  let game = await Games.findOneAsync({ searchName: searchName });
  
  if (game) {
    return game;
  }
  
  // Try partial match in cache
  game = await Games.findOneAsync({ 
    searchName: { $regex: `^${escapeRegex(searchName)}$`, $options: 'i' } 
  });
  
  if (game) {
    return game;
  }
  
  // Search IGDB
  const igdbGame = await findGameByName(name, platform);
  
  if (!igdbGame) {
    return null;
  }
  
  // Check if we already have this game by IGDB ID
  game = await Games.findOneAsync({ igdbId: igdbGame.id });
  
  if (game) {
    return game;
  }
  
  // Transform and save
  const gameData = transformIgdbGame(igdbGame);
  gameData.createdAt = new Date();
  
  try {
    const gameId = await Games.insertAsync(gameData);
    const newGame = await Games.findOneAsync(gameId);
    
    // Queue cover download if has cover image
    if (newGame && newGame.coverImageId) {
      queueCoverDownload(newGame._id, newGame.coverImageId, 5).catch(error => {
        console.error('Error queueing cover download:', error);
      });
    }
    
    return newGame;
  } catch (error) {
    // Handle duplicate key error (race condition)
    if (error.message.includes('duplicate key')) {
      return Games.findOneAsync({ igdbId: igdbGame.id });
    }
    throw error;
  }
}

// Update a game from IGDB (for refresh)
export async function refreshGame(gameId) {
  const game = await Games.findOneAsync(gameId);
  
  if (!game || !game.igdbId) {
    return null;
  }
  
  const igdbGame = await getGameById(game.igdbId);
  
  if (!igdbGame) {
    return game;
  }
  
  // Check if update is needed based on checksum
  const checksumChanged = game.igdbChecksum !== igdbGame.checksum;
  
  if (!checksumChanged) {
    // Just update the timestamp
    await Games.updateAsync(gameId, { 
      $set: { updatedAt: new Date() } 
    });
    return Games.findOneAsync(gameId);
  }
  
  // Update with new data
  const gameData = transformIgdbGame(igdbGame);
  
  // Check if cover image changed or if we don't have a local cover
  const coverChanged = game.coverImageId !== igdbGame.cover?.image_id;
  const needsCover = !game.localCoverId && igdbGame.cover?.image_id;
  
  // Clear local cover reference if cover changed
  if (coverChanged && game.localCoverId) {
    gameData.localCoverId = null;
    gameData.localCoverUpdatedAt = null;
  }
  
  await Games.updateAsync(gameId, { $set: gameData });
  
  // Queue cover download if cover changed or we don't have one
  if ((coverChanged || needsCover) && igdbGame.cover?.image_id) {
    queueCoverDownload(gameId, igdbGame.cover.image_id, 3).catch(error => {
      console.error('Error queueing cover download during refresh:', error);
    });
  }
  
  return Games.findOneAsync(gameId);
}

// Refresh all games that haven't been updated in the specified time
export async function refreshStaleGames(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoffDate = new Date(Date.now() - maxAgeMs);
  
  const staleGames = await Games.find({
    updatedAt: { $lt: cutoffDate }
  }, {
    fields: { _id: 1, igdbId: 1, coverImageId: 1, localCoverId: 1, igdbChecksum: 1 },
    limit: 100 // Process in batches
  }).fetchAsync();
  
  if (staleGames.length === 0) {
    return { refreshed: 0, coversQueued: 0, total: 0 };
  }
  
  const igdbIds = staleGames.map(g => g.igdbId).filter(Boolean);
  
  if (igdbIds.length === 0) {
    return { refreshed: 0, coversQueued: 0, total: staleGames.length };
  }
  
  // Fetch fresh data from IGDB
  const igdbGames = await getGamesByIds(igdbIds);
  
  let refreshedCount = 0;
  let coversQueuedCount = 0;
  
  for (const igdbGame of igdbGames) {
    const existingGame = staleGames.find(g => g.igdbId === igdbGame.id);

    if (existingGame) {
      const gameData = transformIgdbGame(igdbGame);

      // Check if cover image changed or if we don't have a local cover
      const coverChanged = existingGame.coverImageId !== igdbGame.cover?.image_id;
      const needsCover = !existingGame.localCoverId && igdbGame.cover?.image_id;

      // Clear local cover reference if cover changed
      if (coverChanged && existingGame.localCoverId) {
        gameData.localCoverId = null;
        gameData.localCoverUpdatedAt = null;
      }

      await Games.updateAsync(existingGame._id, { $set: gameData });
      refreshedCount++;

      // Queue cover download if cover changed or we don't have one
      if ((coverChanged || needsCover) && igdbGame.cover?.image_id) {
        try {
          await queueCoverDownload(existingGame._id, igdbGame.cover.image_id, 7);
          coversQueuedCount++;
        } catch (error) {
          console.error('Error queueing cover download during refresh:', error);
        }
      }
    }
  }

  // Check for missing cover files on disk and requeue if needed
  let missingCoversRequeued = 0;
  for (const game of staleGames) {
    if (game.coverImageId) {
      const missing = await isCoverFileMissing(game.localCoverId);
      if (missing) {
        // Clear stale reference if it exists
        if (game.localCoverId) {
          await Games.updateAsync(game._id, {
            $set: { localCoverId: null, localCoverUrl: null }
          });
        }
        // Delete any existing COMPLETED queue item so we can re-queue
        await CoverQueue.removeAsync({
          gameId: game._id,
          status: QueueStatus.COMPLETED
        });
        try {
          await queueCoverDownload(game._id, game.coverImageId, 7);
          missingCoversRequeued++;
        } catch (error) {
          console.error('Error queueing missing cover download:', error);
        }
      }
    }
  }

  return {
    refreshed: refreshedCount,
    coversQueued: coversQueuedCount,
    missingCoversRequeued,
    total: staleGames.length
  };
}
