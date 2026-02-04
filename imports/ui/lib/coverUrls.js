/**
 * coverUrls.js - Shared utilities for game cover image URLs
 *
 * Consolidates cover URL logic used across GameCard, BookshelfItem, and GameCase3D.
 */

// SVG placeholder for games without covers (300x400 aspect ratio)
export const noCoverSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgMzAwIDQwMCI+CiAgPHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNmMGYwZjAiLz4KICA8dGV4dCB4PSIxNTAiIHk9IjIwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2FhYSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2Ij5ObyBDb3ZlcjwvdGV4dD4KPC9zdmc+';

// Smaller SVG placeholder for bookshelf items (108x149 aspect ratio)
export const noCoverSvgSmall = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTQ5IiB2aWV3Qm94PSIwIDAgMTA4IDE0OSI+CiAgPHJlY3Qgd2lkdGg9IjEwOCIgaGVpZ2h0PSIxNDkiIGZpbGw9IiM0NDQiLz4KICA8dGV4dCB4PSI1NCIgeT0iNzQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM4ODgiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiI+Tm8gQ292ZXI8L3RleHQ+Cjwvc3ZnPg==';

/**
 * Get all available cover sources for a game with fallback chain
 *
 * @param {Object} game - Game object with cover fields
 * @returns {{ localCoverUrl: string|null, igdbCoverUrl: string|null }}
 */
export function getCoverSources(game) {
  if (!game) {
    return { localCoverUrl: null, igdbCoverUrl: null };
  }

  // Local cover takes priority (processed WebP from our server)
  const localCoverUrl = game.localCoverUrl || null;

  // Build IGDB cover URL from available fields
  let igdbCoverUrl = null;
  if (game.coverImageId) {
    igdbCoverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.coverImageId}.jpg`;
  } else if (game.igdbCoverUrl) {
    igdbCoverUrl = game.igdbCoverUrl;
  }

  return { localCoverUrl, igdbCoverUrl };
}

/**
 * Get the primary cover URL for a game (first available in fallback chain)
 *
 * @param {Object} game - Game object with cover fields
 * @returns {string} - Cover URL or placeholder
 */
export function getCoverUrl(game) {
  const { localCoverUrl, igdbCoverUrl } = getCoverSources(game);
  return localCoverUrl || igdbCoverUrl || noCoverSvg;
}

/**
 * Get array of URLs to preload for a game (filters out nulls and placeholders)
 *
 * @param {Object} game - Game object with cover fields
 * @returns {string[]} - Array of URLs to preload
 */
export function getPreloadUrls(game) {
  const { localCoverUrl, igdbCoverUrl } = getCoverSources(game);
  const urls = [];

  // Prefer local cover, but include IGDB as fallback
  if (localCoverUrl) {
    urls.push(localCoverUrl);
  }
  if (igdbCoverUrl) {
    urls.push(igdbCoverUrl);
  }

  return urls;
}
