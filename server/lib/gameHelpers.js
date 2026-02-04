/**
 * gameHelpers.js - Shared utilities for game data manipulation
 */

/**
 * Build the embedded game subdocument for denormalization in collectionItems.
 * This contains frequently-accessed game fields to avoid $lookup aggregations.
 *
 * @param {Object} game - Full game document from Games collection
 * @returns {Object|null} - Embedded game subdocument or null if no game
 */
export function buildEmbeddedGame(game) {
  if (!game) {
    return null;
  }

  return {
    title: game.title || null,
    releaseYear: game.releaseYear || null,
    ownerId: game.ownerId || null,
    genres: game.genres || [],
    localCoverUrl: game.localCoverUrl || null,
    coverImageId: game.coverImageId || null,
    igdbCoverUrl: game.igdbCoverUrl || null
  };
}
