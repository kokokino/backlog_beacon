import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// Xbox OAuth / API constants (OpenXbox public client - works without app registration)
const XBOX_CLIENT_ID = '388ea51c-0b25-4029-aae2-17df49d23905';
const XBOX_REDIRECT_URI = 'http://localhost:8080/auth/callback';
const XBOX_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const XBOX_LIVE_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XBOX_XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const XBOX_TITLEHUB_URL = 'https://titlehub.xboxlive.com';
const XBOX_USERSTATS_URL = 'https://userstats.xboxlive.com';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

// Sleep helper for retry logic
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with retry logic for rate limiting
async function fetchWithRetry(url, options = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        console.log(`Xbox API rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
        lastError = new Error('Xbox API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Meteor.Error('auth-invalid', 'Authorization code is invalid or expired. Please get a new code from Microsoft.');
      }

      if (!response.ok) {
        throw new Error(`Xbox API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      // Re-throw Meteor errors immediately
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(`Xbox API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', 'Could not connect to Xbox services. Please try again later.');
}

// Step 1: Exchange authorization code for OAuth access token
async function exchangeCodeForToken(authCode) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authCode,
    client_id: XBOX_CLIENT_ID,
    redirect_uri: XBOX_REDIRECT_URI,
    scope: 'Xboxlive.signin Xboxlive.offline_access'
  });

  const response = await fetchWithRetry(XBOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const data = await response.json();

  if (!data.access_token) {
    throw new Meteor.Error('auth-invalid', 'Failed to get access token from Microsoft. Please try again with a new code.');
  }

  return data.access_token;
}

// Step 2: Authenticate with Xbox Live using the OAuth access token
async function authenticateXboxLive(accessToken) {
  const response = await fetchWithRetry(XBOX_LIVE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-xbl-contract-version': '1'
    },
    body: JSON.stringify({
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${accessToken}`
      }
    })
  });

  const data = await response.json();

  if (!data.Token) {
    throw new Meteor.Error('auth-invalid', 'Failed to authenticate with Xbox Live.');
  }

  return data.Token;
}

// Step 3: Authorize with XSTS to get final token + XUID + UHS
async function authorizeXSTS(xblToken) {
  const response = await fetchWithRetry(XBOX_XSTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-xbl-contract-version': '1'
    },
    body: JSON.stringify({
      RelyingParty: 'http://xboxlive.com',
      TokenType: 'JWT',
      Properties: {
        UserTokens: [xblToken],
        SandboxId: 'RETAIL'
      }
    })
  });

  const data = await response.json();

  if (!data.Token || !data.DisplayClaims?.xui?.[0]) {
    throw new Meteor.Error('auth-invalid', 'Failed to authorize with Xbox services.');
  }

  const xui = data.DisplayClaims.xui[0];

  return {
    xstsToken: data.Token,
    xuid: xui.xid,
    uhs: xui.uhs
  };
}

// Build XBL3.0 authorization header
function buildXblAuthHeader(uhs, xstsToken) {
  return `XBL3.0 x=${uhs};${xstsToken}`;
}

// Fetch title history (games the user has played)
async function fetchTitleHistory(xuid, xstsToken, uhs) {
  const url = `${XBOX_TITLEHUB_URL}/users/xuid(${xuid})/titles/titlehistory/decoration/detail?maxItems=1000`;

  const response = await fetchWithRetry(url, {
    headers: {
      'Authorization': buildXblAuthHeader(uhs, xstsToken),
      'Accept': 'application/json',
      'x-xbl-contract-version': '2',
      'Accept-Language': 'en-US',
      'x-xbl-client-name': 'XboxApp',
      'x-xbl-client-type': 'UWA',
      'x-xbl-client-version': '39.39.22001.0'
    }
  });

  const data = await response.json();
  const titles = data.titles || [];

  return titles;
}

// Fetch playtime stats for a batch of title IDs
async function fetchPlaytimes(xuid, titleIds, xstsToken, uhs) {
  const playtimeMap = new Map();

  if (!titleIds || titleIds.length === 0) {
    return playtimeMap;
  }

  // Process in chunks of 100 to avoid overly large requests
  const chunkSize = 100;
  for (let start = 0; start < titleIds.length; start += chunkSize) {
    const chunk = titleIds.slice(start, start + chunkSize);

    try {
      const requestBody = {
        arrangebyfield: 'xuid',
        xuids: [xuid],
        groups: [{
          name: 'Hero',
          titleIds: chunk
        }],
        stats: [{
          name: 'MinutesPlayed',
          type: 'Integer'
        }]
      };

      const response = await fetchWithRetry(`${XBOX_USERSTATS_URL}/batch`, {
        method: 'POST',
        headers: {
          'Authorization': buildXblAuthHeader(uhs, xstsToken),
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-xbl-contract-version': '1'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      // Parse stats response
      const groups = data.groups || [];
      for (const group of groups) {
        const statlistscollection = group.statlistscollection || [];
        for (const statList of statlistscollection) {
          const stats = statList.stats || [];
          for (const stat of stats) {
            if (stat.name === 'MinutesPlayed' && stat.value) {
              const minutes = parseInt(stat.value, 10);
              if (minutes > 0 && stat.groupproperties?.Other) {
                const titleId = stat.groupproperties.Other;
                // Convert minutes to hours, rounded to 1 decimal
                const hours = Math.round((minutes / 60) * 10) / 10;
                playtimeMap.set(titleId, hours);
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch Xbox playtime for chunk starting at ${start}:`, error.message);
      // Continue with other chunks
    }
  }

  return playtimeMap;
}

// Normalize Xbox game names for better IGDB matching
function normalizeXboxGameName(name) {
  let normalized = name;

  // Strip trademark symbols
  normalized = normalized.replace(/[™®©]/g, '');

  // Remove platform suffixes
  normalized = normalized.replace(/\s*\(PC\)\s*$/i, '');
  normalized = normalized.replace(/\s*\(Windows\)\s*$/i, '');
  normalized = normalized.replace(/\s*\(Xbox One\)\s*$/i, '');
  normalized = normalized.replace(/\s*\(Xbox Series X\|S\)\s*$/i, '');
  normalized = normalized.replace(/\s*\(Xbox 360\)\s*$/i, '');
  normalized = normalized.replace(/\s*for Windows 10\s*$/i, '');
  normalized = normalized.replace(/\s*[-–—]\s*Windows 10\s*$/i, '');
  normalized = normalized.replace(/\s*[-–—]\s*Windows Edition\s*$/i, '');

  // Remove common edition suffixes for better matching
  normalized = normalized.replace(/\s*[-–—:]\s*(Deluxe|Standard|Ultimate|Gold|Premium|Complete|Game of the Year|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*Edition\s*$/i, '');

  // Remove trailing edition words without "Edition"
  normalized = normalized.replace(/\s+(Deluxe|Standard|Ultimate|Gold|Premium|Complete|GOTY|Digital|Launch|Limited|Collector'?s?|Legacy|Definitive|Enhanced|Remastered)\s*$/i, '');

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// Map Xbox device strings to platform names used in our system
function mapXboxDevicesToPlatforms(devices) {
  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    return ['PC']; // Default to PC if no device info
  }

  const platformMap = {
    'PC': 'PC',
    'Win32': 'PC',
    'Xbox360': 'Xbox 360',
    'XboxOne': 'Xbox One',
    'XboxSeries': 'Xbox Series X|S'
  };

  const platforms = [];
  const seen = new Set();

  for (const device of devices) {
    const platform = platformMap[device];
    if (platform && !seen.has(platform)) {
      platforms.push(platform);
      seen.add(platform);
    }
  }

  return platforms.length > 0 ? platforms : ['PC'];
}

// Determine storefront based on platforms
function determineStorefronts(platforms) {
  const hasConsole = platforms.some(platform =>
    platform === 'Xbox 360' || platform === 'Xbox One' || platform === 'Xbox Series X|S'
  );
  const hasPC = platforms.includes('PC');

  const storefronts = [];
  if (hasPC) {
    storefronts.push('microsoft');
  }
  if (hasConsole) {
    storefronts.push('xbox');
  }

  // Default to microsoft if no platform matched
  return storefronts.length > 0 ? storefronts : ['microsoft'];
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

// Main import function
export async function importXboxLibrary(userId, authCode, options = {}) {
  const { updateExisting = true, importPlaytime = true } = options;

  // Step 1: Exchange auth code for OAuth token
  const accessToken = await exchangeCodeForToken(authCode);

  // Step 2: Authenticate with Xbox Live
  const xblToken = await authenticateXboxLive(accessToken);

  // Step 3: Authorize with XSTS
  const { xstsToken, xuid, uhs } = await authorizeXSTS(xblToken);

  // Step 4: Fetch title history
  const allTitles = await fetchTitleHistory(xuid, xstsToken, uhs);

  // Filter to games only (exclude apps, DLC, etc.)
  const gameTitles = allTitles.filter(title => title.type === 'Game');

  // Deduplicate by titleId
  const seen = new Set();
  const uniqueGames = [];
  for (const title of gameTitles) {
    const titleId = title.titleId;
    if (titleId && !seen.has(titleId)) {
      seen.add(titleId);
      uniqueGames.push(title);
    }
  }

  if (uniqueGames.length === 0) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      games: []
    };
  }

  // Fetch playtime if requested
  let playtimeMap = new Map();
  if (importPlaytime) {
    const titleIds = uniqueGames.map(title => title.titleId).filter(Boolean);
    playtimeMap = await fetchPlaytimes(xuid, titleIds, xstsToken, uhs);
  }

  // Build games array
  const games = uniqueGames.map(title => {
    const platforms = mapXboxDevicesToPlatforms(title.devices);
    const storefronts = determineStorefronts(platforms);

    return {
      title: title.name,
      titleId: title.titleId,
      platforms,
      storefronts,
      hoursPlayed: playtimeMap.get(title.titleId) || null
    };
  });

  // Sort by playtime (most played first) for better UX
  games.sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0));

  // Process the import
  return processXboxImport(userId, games, { updateExisting, importPlaytime });
}

// Process import - following Epic/EA patterns
async function processXboxImport(userId, games, options) {
  const { updateExisting, importPlaytime } = options;

  const results = {
    total: games.length,
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
    total: games.length,
    currentGame: '',
    imported: 0,
    updated: 0,
    skipped: 0
  });

  try {
    for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
      const xboxGame = games[gameIndex];
      const gameName = xboxGame.title;
      const normalizedName = normalizeXboxGameName(gameName);
      const searchPlatform = xboxGame.platforms.includes('PC') ? 'PC' : xboxGame.platforms[0];

      // Update progress before processing each game
      await updateProgress(userId, {
        status: 'processing',
        current: gameIndex + 1,
        total: games.length,
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
            cachedGame = await searchAndCacheGame(normalizedName, searchPlatform);
            if (cachedGame) {
              gameId = cachedGame._id;
              igdbId = cachedGame.igdbId;
            }
          } catch (error) {
            console.warn(`IGDB search failed for "${gameName}":`, error.message);
          }
        }

        // Skip games not found in IGDB
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

        // Prepare playtime data
        const hoursPlayed = importPlaytime ? xboxGame.hoursPlayed : null;

        if (existing) {
          if (updateExisting) {
            // Merge platforms
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = [...new Set([...existingPlatforms, ...xboxGame.platforms])];

            // Merge storefronts
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = [...new Set([...existingStorefronts, ...xboxGame.storefronts])];

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

            await CollectionItems.updateAsync(existing._id, { $set: updateFields });

            results.updated++;
            results.games.push({ name: gameName, matchedName: cachedGame?.title || null, action: 'updated' });
          } else {
            results.skipped++;
            results.games.push({ name: gameName, action: 'skipped', reason: 'Already in collection' });
          }
          continue;
        }

        // Create new collection item
        const collectionItem = {
          userId,
          platforms: xboxGame.platforms,
          storefronts: xboxGame.storefronts,
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

        // Only set gameId/igdbId if found
        if (gameId) {
          collectionItem.gameId = gameId;
          collectionItem.game = buildEmbeddedGame(cachedGame);
        }
        if (igdbId) {
          collectionItem.igdbId = igdbId;
        }

        await CollectionItems.insertAsync(collectionItem);

        results.imported++;
        results.games.push({ name: gameName, matchedName: cachedGame?.title || null, action: 'imported' });
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
      current: games.length,
      total: games.length,
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
