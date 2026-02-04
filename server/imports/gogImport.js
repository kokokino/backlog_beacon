import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

const GOG_PUBLIC_API = 'https://www.gog.com/u';
const GOG_ACCOUNT_API = 'https://www.gog.com/account/getFilteredProducts';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

// Extract username from GOG profile URL or return as-is
export function extractGogUsername(input) {
  if (!input || typeof input !== 'string') {
    throw new Meteor.Error('invalid-username', 'Please enter a GOG username or profile URL.');
  }

  const trimmed = input.trim();

  // Match GOG profile URLs
  // https://www.gog.com/u/username
  // https://www.gog.com/u/username/games
  // gog.com/u/username
  const profileMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?gog\.com\/u\/([^\/\?\s]+)/i);
  if (profileMatch) {
    return profileMatch[1];
  }

  // Return as-is (assume it's a username)
  return trimmed;
}

// Sleep helper for retry logic
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with retry logic for 429 errors
async function fetchWithRetry(url, options = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        console.log(`GOG API rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
        lastError = new Error('GOG API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (response.status === 404) {
        throw new Meteor.Error('profile-not-found', 'GOG profile not found. Check your username or profile URL.');
      }

      if (response.status === 403) {
        throw new Meteor.Error('profile-private', 'Could not access game library. Your GOG profile may be private. Go to gog.com/account/settings/privacy and set your profile to Public, or use the Login method instead.');
      }

      if (!response.ok) {
        throw new Error(`GOG API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      // Re-throw Meteor errors immediately
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(`GOG API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', 'Could not connect to GOG. Please try again later.');
}

// Format playtime from minutes to hours
function formatPlaytimeHours(minutes) {
  if (!minutes || minutes === 0) {
    return null;
  }
  return Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal place
}

// Format last session date
function formatLastPlayed(lastSession) {
  if (!lastSession) {
    return null;
  }
  const date = new Date(lastSession);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date;
}

// Fetch all pages from GOG public profile API
async function fetchGogPublicLibrary(username) {
  const allGames = [];
  let currentPage = 1;
  let totalPages = 1;

  do {
    const url = `${GOG_PUBLIC_API}/${encodeURIComponent(username)}/games/stats?page=${currentPage}`;
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for empty or invalid response (could indicate private profile)
    if (!data._embedded || !data._embedded.items) {
      if (currentPage === 1) {
        throw new Meteor.Error('profile-private', 'Could not access game library. Your GOG profile may be private. Go to gog.com/account/settings/privacy and set your profile to Public, or use the Login method instead.');
      }
      break;
    }

    const items = data._embedded.items || [];
    for (const item of items) {
      if (item.game && item.game.title) {
        allGames.push({
          gogId: item.game.id,
          title: item.game.title,
          playtime: item.stats?.playtime || 0, // in minutes
          lastSession: item.stats?.lastSession || null
        });
      }
    }

    totalPages = data.pages || 1;
    currentPage++;
  } while (currentPage <= totalPages);

  return allGames;
}

// Format session cookie for GOG API
function formatSessionCookie(sessionCookie) {
  const trimmed = sessionCookie.trim();

  // If it already looks like a cookie header (contains =), use as-is
  if (trimmed.includes('=')) {
    // Check if it's already properly formatted with gog-al
    if (trimmed.startsWith('gog-al=') || trimmed.includes('; gog-al=')) {
      return trimmed;
    }
    // User might have pasted multiple cookies or other format, use as-is
    return trimmed;
  }

  // If it's just the value, format it as gog-al cookie
  return `gog-al=${trimmed}`;
}

// Fetch all pages from GOG authenticated API
async function fetchGogAuthenticatedLibrary(sessionCookie) {
  const allGames = [];
  let currentPage = 1;
  let totalPages = 1;

  const formattedCookie = formatSessionCookie(sessionCookie);

  do {
    const url = `${GOG_ACCOUNT_API}?mediaType=1&page=${currentPage}`;
    const response = await fetchWithRetry(url, {
      headers: {
        'Cookie': formattedCookie
      }
    });

    // Check content type before parsing
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // GOG returned HTML (likely login page) - session is invalid
      throw new Meteor.Error('session-invalid', 'GOG session is invalid or expired. Please get a fresh session cookie from GOG.com.');
    }

    const data = await response.json();

    // Check for invalid response (might indicate expired session)
    if (!data.products) {
      if (currentPage === 1) {
        throw new Meteor.Error('session-invalid', 'GOG session is invalid or expired. Please login again.');
      }
      break;
    }

    const products = data.products || [];
    for (const product of products) {
      // Only include games (isGame: true)
      if (product.isGame && product.title) {
        allGames.push({
          gogId: String(product.id),
          title: product.title,
          playtime: 0, // Authenticated endpoint doesn't include playtime
          lastSession: null
        });
      }
    }

    totalPages = data.totalPages || 1;
    currentPage++;
  } while (currentPage <= totalPages);

  return allGames;
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

// Clear progress from the database
export async function clearGogProgress(userId) {
  await ImportProgress.removeAsync({ userId, type: 'storefront' });
}

// Preview GOG library using public profile (returns first 50 games sorted by playtime)
export async function previewGogLibrary(gogUsername) {
  // Extract username from URL if needed
  const username = extractGogUsername(gogUsername);

  // Fetch games from public profile
  const games = await fetchGogPublicLibrary(username);

  // Sort by playtime (most played first)
  const sortedGames = [...games].sort((a, b) => (b.playtime || 0) - (a.playtime || 0));

  // Return preview of first 50 games
  const previewGames = sortedGames.slice(0, 50).map(game => ({
    gogId: game.gogId,
    name: game.title,
    hoursPlayed: formatPlaytimeHours(game.playtime),
    lastPlayed: formatLastPlayed(game.lastSession)
  }));

  return {
    total: games.length,
    games: previewGames
  };
}

// Preview GOG library using authenticated session
export async function previewGogLibraryWithAuth(sessionCookie) {
  if (!sessionCookie || typeof sessionCookie !== 'string') {
    throw new Meteor.Error('invalid-session', 'No GOG session provided. Please login to GOG first.');
  }

  // Fetch games using session cookie
  const games = await fetchGogAuthenticatedLibrary(sessionCookie);

  // Sort alphabetically since we don't have playtime data
  const sortedGames = [...games].sort((a, b) => a.title.localeCompare(b.title));

  // Return preview of first 50 games
  const previewGames = sortedGames.slice(0, 50).map(game => ({
    gogId: game.gogId,
    name: game.title,
    hoursPlayed: null, // Authenticated endpoint doesn't include playtime
    lastPlayed: null
  }));

  return {
    total: games.length,
    games: previewGames
  };
}

// Import GOG library using public profile
export async function importGogLibrary(userId, gogUsername, options = {}) {
  const { updateExisting = true, importPlaytime = true, importLastPlayed = true } = options;

  // Extract username from URL if needed
  const username = extractGogUsername(gogUsername);

  // Fetch games from public profile
  const games = await fetchGogPublicLibrary(username);

  return processGogImport(userId, games, {
    updateExisting,
    importPlaytime,
    importLastPlayed
  });
}

// Import GOG library using authenticated session
export async function importGogLibraryWithAuth(userId, sessionCookie, options = {}) {
  const { updateExisting = true } = options;

  if (!sessionCookie || typeof sessionCookie !== 'string') {
    throw new Meteor.Error('invalid-session', 'No GOG session provided. Please login to GOG first.');
  }

  // Fetch games using session cookie
  const games = await fetchGogAuthenticatedLibrary(sessionCookie);

  // Note: Authenticated endpoint doesn't include playtime data
  return processGogImport(userId, games, {
    updateExisting,
    importPlaytime: false, // No playtime data available
    importLastPlayed: false // No last played data available
  });
}

// Common import processing logic
async function processGogImport(userId, games, options) {
  const { updateExisting, importPlaytime, importLastPlayed } = options;

  if (games.length === 0) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      games: []
    };
  }

  // Sort by playtime (most played first) for better UX during import
  const sortedGames = [...games].sort((a, b) => (b.playtime || 0) - (a.playtime || 0));

  const results = {
    total: sortedGames.length,
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
    total: sortedGames.length,
    currentGame: '',
    imported: 0,
    updated: 0,
    skipped: 0
  });

  try {
    for (let gameIndex = 0; gameIndex < sortedGames.length; gameIndex++) {
      const gogGame = sortedGames[gameIndex];
      const gameName = gogGame.title;

      // Update progress before processing each game
      await updateProgress(userId, {
        status: 'processing',
        current: gameIndex + 1,
        total: sortedGames.length,
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
            cachedGame = await searchAndCacheGame(gameName, 'PC');
            if (cachedGame) {
              gameId = cachedGame._id;
              igdbId = cachedGame.igdbId;
            }
          } catch (error) {
            console.warn(`IGDB search failed for "${gameName}":`, error.message);
          }
        }

        // Skip games not found in IGDB - we can't properly track them without a gameId
        // (unique index on userId+gameId would cause duplicates with null gameId)
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

        // Prepare playtime and last played data
        const hoursPlayed = importPlaytime ? formatPlaytimeHours(gogGame.playtime) : null;
        const lastPlayed = importLastPlayed ? formatLastPlayed(gogGame.lastSession) : null;

        if (existing) {
          if (updateExisting) {
            // Merge platforms: add PC if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes('PC')
              ? existingPlatforms
              : [...existingPlatforms, 'PC'];

            // Merge storefronts: add gog if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('gog')
              ? existingStorefronts
              : [...existingStorefronts, 'gog'];

            const updateFields = {
              platforms: mergedPlatforms,
              storefronts: mergedStorefronts,
              updatedAt: new Date()
            };

            // Update playtime if importing and greater than existing
            if (importPlaytime && hoursPlayed !== null) {
              if (!existing.hoursPlayed || hoursPlayed > existing.hoursPlayed) {
                updateFields.hoursPlayed = hoursPlayed;
              }
            }

            // Update last played date if importing
            if (importLastPlayed && lastPlayed !== null) {
              updateFields.lastPlayed = lastPlayed;
            }

            await CollectionItems.updateAsync(existing._id, { $set: updateFields });

            results.updated++;
            results.games.push({ name: gameName, action: 'updated' });
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
          storefronts: ['gog'],
          status: 'backlog',
          favorite: false,
          hoursPlayed: hoursPlayed,
          rating: null,
          notes: '',
          physical: false,
          dateAdded: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Add last played date if importing
        if (importLastPlayed && lastPlayed !== null) {
          collectionItem.lastPlayed = lastPlayed;
        }

        // Only set gameId/igdbId if found - omitting allows sparse index to work
        if (gameId) {
          collectionItem.gameId = gameId;
          collectionItem.game = buildEmbeddedGame(cachedGame);
        }
        if (igdbId) {
          collectionItem.igdbId = igdbId;
        }

        await CollectionItems.insertAsync(collectionItem);

        results.imported++;
        results.games.push({ name: gameName, action: 'imported' });
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
      current: sortedGames.length,
      total: sortedGames.length,
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
