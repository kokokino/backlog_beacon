import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';

const STEAM_API_BASE = 'https://api.steampowered.com';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

// Check if Steam import is configured (API key in settings)
export function isSteamConfigured() {
  const apiKey = Meteor.settings?.private?.steam?.apiKey;
  return apiKey && typeof apiKey === 'string' && /^[A-Fa-f0-9]{32}$/.test(apiKey.trim());
}

// Get the Steam API key from settings
function getApiKey() {
  const apiKey = Meteor.settings?.private?.steam?.apiKey;
  if (!apiKey || typeof apiKey !== 'string' || !/^[A-Fa-f0-9]{32}$/.test(apiKey.trim())) {
    throw new Meteor.Error('steam-not-configured', 'Steam import is not configured. Please contact support.');
  }
  return apiKey.trim();
}

// Validate Steam ID format (17 digit number)
function validateSteamId(steamId) {
  if (!steamId || typeof steamId !== 'string') {
    return false;
  }
  return /^\d{17}$/.test(steamId.trim());
}

// Extract username from Steam profile URL or return as-is
function extractSteamUsername(input) {
  if (!input || typeof input !== 'string') {
    throw new Meteor.Error('invalid-username', 'Please enter a Steam username or profile URL.');
  }

  const trimmed = input.trim();

  // Match Steam profile URLs
  // https://steamcommunity.com/id/username
  // https://steamcommunity.com/profiles/71212121212121212
  const idMatch = trimmed.match(/steamcommunity\.com\/id\/([^\/\?\s]+)/i);
  if (idMatch) {
    return idMatch[1];
  }

  const profilesMatch = trimmed.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profilesMatch) {
    return profilesMatch[1];
  }

  // Return as-is (could be username or Steam ID)
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
        console.log(`Steam API rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
        lastError = new Error('Steam API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(`Steam API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

// Resolve vanity URL to Steam ID
async function resolveSteamId(apiKey, steamIdOrVanity) {
  const trimmed = steamIdOrVanity.trim();

  // If it looks like a Steam ID (17 digits), use it directly
  if (validateSteamId(trimmed)) {
    return trimmed;
  }

  // Otherwise, try to resolve as vanity URL
  const url = `${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(trimmed)}`;

  const data = await fetchWithRetry(url);

  if (data.response?.success === 1 && data.response?.steamid) {
    return data.response.steamid;
  }

  // Steam returns success: 42 when vanity URL not found
  throw new Meteor.Error('invalid-steam-id', 'Could not find Steam profile. Check your Steam ID or profile URL.');
}

// Fetch owned games from Steam API
async function fetchSteamGames(apiKey, steamId) {
  const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true&include_free_sub=true&format=json`;

  const data = await fetchWithRetry(url);

  if (!data.response || (data.response.games === undefined && data.response.game_count === undefined)) {
    throw new Meteor.Error('steam-profile-private', 'Could not retrieve game library. Your Steam profile may be private. Go to Steam > Profile > Edit Profile > Privacy Settings and set "Game details" to Public.');
  }

  const games = data.response.games || [];

  return games;
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
export async function clearStorefrontProgress(userId) {
  await ImportProgress.removeAsync({ userId, type: 'storefront' });
}

// Format playtime from minutes to hours
function formatPlaytimeHours(minutes) {
  if (!minutes || minutes === 0) {
    return null;
  }
  return Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal place
}

// Format last played timestamp to Date
function formatLastPlayed(rtimeLastPlayed) {
  if (!rtimeLastPlayed || rtimeLastPlayed === 0) {
    return null;
  }
  return new Date(rtimeLastPlayed * 1000);
}

// Preview Steam library (returns first 50 games sorted by playtime)
export async function previewSteamLibrary(steamUsername) {
  // Get API key from settings
  const apiKey = getApiKey();

  // Extract username from URL if needed
  const username = extractSteamUsername(steamUsername);

  // Resolve Steam ID (handles vanity URLs)
  let resolvedSteamId;
  try {
    resolvedSteamId = await resolveSteamId(apiKey, username);
  } catch (error) {
    if (error.error === 'invalid-steam-id') {
      throw new Meteor.Error('invalid-username', 'Could not find Steam profile. Check your username or profile URL.');
    }
    throw error;
  }

  // Fetch games
  const games = await fetchSteamGames(apiKey, resolvedSteamId);

  // Sort by playtime (most played first)
  const sortedGames = [...games].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));

  // Return preview of first 50 games
  const previewGames = sortedGames.slice(0, 50).map(game => ({
    appId: game.appid,
    name: game.name || `App ${game.appid}`,
    hoursPlayed: formatPlaytimeHours(game.playtime_forever),
    lastPlayed: formatLastPlayed(game.rtime_last_played)
  }));

  return {
    total: games.length,
    games: previewGames
  };
}

// Import Steam library with IGDB matching
export async function importSteamLibrary(userId, steamUsername, options = {}) {
  const { updateExisting = true, importPlaytime = true, importLastPlayed = true } = options;

  // Get API key from settings
  const apiKey = getApiKey();

  // Extract username from URL if needed
  const username = extractSteamUsername(steamUsername);

  // Resolve Steam ID (handles vanity URLs)
  let resolvedSteamId;
  try {
    resolvedSteamId = await resolveSteamId(apiKey, username);
  } catch (error) {
    if (error.error === 'invalid-steam-id') {
      throw new Meteor.Error('invalid-username', 'Could not find Steam profile. Check your username or profile URL.');
    }
    throw error;
  }

  // Fetch games
  const games = await fetchSteamGames(apiKey, resolvedSteamId);

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
  const sortedGames = [...games].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));

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
    for (let i = 0; i < sortedGames.length; i++) {
      const steamGame = sortedGames[i];
      const gameName = steamGame.name || `Steam App ${steamGame.appid}`;

      // Update progress before processing each game
      await updateProgress(userId, {
        status: 'processing',
        current: i + 1,
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
        const hoursPlayed = importPlaytime ? formatPlaytimeHours(steamGame.playtime_forever) : null;
        const lastPlayed = importLastPlayed ? formatLastPlayed(steamGame.rtime_last_played) : null;

        if (existing) {
          if (updateExisting) {
            // Merge platforms: add PC if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes('PC')
              ? existingPlatforms
              : [...existingPlatforms, 'PC'];

            // Merge storefronts: add steam if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('steam')
              ? existingStorefronts
              : [...existingStorefronts, 'steam'];

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
          storefronts: ['steam'],
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
