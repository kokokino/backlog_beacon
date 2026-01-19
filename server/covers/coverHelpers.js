import { GameCovers } from './coversCollection.js';
import { getCoverUrl } from '../igdb/client.js';

// Get the best available cover URL for a game
// Returns local WebP URL if available, otherwise IGDB URL
export function getGameCoverUrl(game, size = 'cover_big') {
  if (!game) {
    return null;
  }
  
  // If we have a local cover, use it
  if (game.localCoverId) {
    const coverFile = GameCovers.findOne(game.localCoverId);
    if (coverFile) {
      return GameCovers.link(coverFile);
    }
  }
  
  // Fall back to IGDB URL
  if (game.coverImageId) {
    return getCoverUrl(game.coverImageId, size);
  }
  
  // Try legacy igdbCoverUrl field
  if (game.igdbCoverUrl) {
    return game.igdbCoverUrl;
  }
  
  return null;
}

// Async version for server-side use
export async function getGameCoverUrlAsync(game, size = 'cover_big') {
  if (!game) {
    return null;
  }
  
  // If we have a local cover, use it
  if (game.localCoverId) {
    const coverFile = await GameCovers.collection.findOneAsync(game.localCoverId);
    if (coverFile) {
      return GameCovers.link(coverFile);
    }
  }
  
  // Fall back to IGDB URL
  if (game.coverImageId) {
    return getCoverUrl(game.coverImageId, size);
  }
  
  // Try legacy igdbCoverUrl field
  if (game.igdbCoverUrl) {
    return game.igdbCoverUrl;
  }
  
  return null;
}

// Get cover URLs for multiple games
export function getGameCoverUrls(games, size = 'cover_big') {
  const coverUrls = {};
  
  for (const game of games) {
    if (game && game._id) {
      coverUrls[game._id] = getGameCoverUrl(game, size);
    }
  }
  
  return coverUrls;
}

// Check if a game has a local cover
export function hasLocalCover(game) {
  return !!(game && game.localCoverId);
}

// Check if a game needs cover processing
export function needsCoverProcessing(game) {
  if (!game) {
    return false;
  }
  
  // Has IGDB image but no local cover
  if (game.coverImageId && !game.localCoverId) {
    return true;
  }
  
  return false;
}
