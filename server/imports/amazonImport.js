import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// Amazon API endpoints and constants (from Playnite's implementation)
const AMAZON_REGISTER_URL = 'https://api.amazon.com/auth/register';
const AMAZON_ENTITLEMENTS_URL = 'https://gaming.amazon.com/api/distribution/entitlements';

// Amazon Games Launcher constants
const AMAZON_DEVICE_TYPE = 'A2UMVHOX7UP4V7';
const AMAZON_KEY_ID = 'd5dc8b8b-86c8-4fc4-ae93-18c0def5314d';

// Build client ID from device serial: serial + "#A2UMVHOX7UP4V7", then hex-encode
function buildClientId(deviceSerial) {
  const clientIdRaw = deviceSerial + '#' + AMAZON_DEVICE_TYPE;
  let hex = '';
  for (let i = 0; i < clientIdRaw.length; i++) {
    hex += clientIdRaw.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

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
        console.log(`Amazon API rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
        lastError = new Error('Amazon API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (response.status === 400 || response.status === 401) {
        throw new Meteor.Error('auth-invalid', 'Authorization code is invalid or expired. Please get a new code from Amazon.');
      }

      if (!response.ok) {
        throw new Error(`Amazon API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      // Re-throw Meteor errors immediately
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(`Amazon API request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', 'Could not connect to Amazon Gaming. Please try again later.');
}

// Exchange authorization code for access token using device registration
async function exchangeCodeForToken(authCode, codeVerifier, deviceSerial) {
  // Build client ID from the device serial (same one used in the OAuth URL)
  const clientId = buildClientId(deviceSerial);

  const requestBody = {
    auth_data: {
      authorization_code: authCode,
      code_verifier: codeVerifier,
      code_algorithm: 'SHA-256',
      client_id: clientId,
      client_domain: 'DeviceLegacy',
      use_global_authentication: false
    },
    registration_data: {
      app_name: 'AGSLauncher for Windows',
      app_version: '1.0.0',
      device_model: 'Windows',
      device_serial: deviceSerial,
      device_type: AMAZON_DEVICE_TYPE,
      domain: 'Device',
      os_version: '10.0'
    },
    requested_extensions: ['customer_info', 'device_info'],
    requested_token_type: ['bearer', 'mac_dms']
  };

  const response = await fetchWithRetry(AMAZON_REGISTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  // Look for the bearer token in the response
  const bearerToken = data?.response?.success?.tokens?.bearer;
  if (!bearerToken?.access_token) {
    throw new Meteor.Error('auth-invalid', 'Failed to get access token from Amazon. The authorization code may be invalid or expired.');
  }

  return {
    accessToken: bearerToken.access_token
  };
}

// Fetch all entitlements with pagination
async function fetchAmazonEntitlements(accessToken, deviceSerial) {
  const allEntitlements = [];
  let nextToken = null;

  // Hardware hash is SHA256 of device serial, uppercase
  const crypto = require('crypto');
  const hardwareHash = crypto.createHash('sha256').update(deviceSerial).digest('hex').toUpperCase();

  do {
    const requestBody = {
      Operation: 'GetEntitlements',
      clientId: 'Sonic',
      syncPoint: null,
      nextToken: nextToken,
      maxResults: 50,
      productIdFilter: null,
      keyId: AMAZON_KEY_ID,
      hardwareHash: hardwareHash
    };

    const response = await fetchWithRetry(AMAZON_ENTITLEMENTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'amz-1.0',
        'X-Amz-Target': 'com.amazon.animusdistributionservice.entitlement.AnimusEntitlementsService.GetEntitlements',
        'x-amzn-token': accessToken,
        'User-Agent': 'com.amazon.agslauncher.win/3.0.9202.1'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    const entitlements = data.entitlements || [];
    allEntitlements.push(...entitlements);

    nextToken = data.nextToken || null;
  } while (nextToken);

  return allEntitlements;
}

// Filter entitlements to only include actual games
function filterEntitlements(entitlements) {
  return entitlements.filter(item => {
    // Skip Twitch Fuel entitlements (not games)
    if (item.productLine === 'Twitch:FuelEntitlement') {
      return false;
    }

    // Must have a product with a title
    if (!item.product?.title) {
      return false;
    }

    return true;
  });
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
export async function importAmazonLibrary(userId, authCode, codeVerifier, deviceSerial, options = {}) {
  const { updateExisting = true } = options;

  // Exchange auth code for access token
  const { accessToken } = await exchangeCodeForToken(authCode, codeVerifier, deviceSerial);

  // Fetch entitlements
  const allEntitlements = await fetchAmazonEntitlements(accessToken, deviceSerial);

  // Filter to only include actual games
  const gameEntitlements = filterEntitlements(allEntitlements);

  if (gameEntitlements.length === 0) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      games: []
    };
  }

  // Build games array
  const games = gameEntitlements.map(item => ({
    title: item.product.title,
    productId: item.product.id,
    asin: item.product.asin
  }));

  // Sort alphabetically for consistent UX
  games.sort((a, b) => a.title.localeCompare(b.title));

  // Process the import
  return processAmazonImport(userId, games, { updateExisting });
}

// Process import - common logic following Epic/GOG pattern
async function processAmazonImport(userId, games, options) {
  const { updateExisting } = options;

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
      const amazonGame = games[gameIndex];
      const gameName = amazonGame.title;

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
            cachedGame = await searchAndCacheGame(gameName, 'PC');
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

        if (existing) {
          if (updateExisting) {
            // Merge platforms: add PC if not present
            const existingPlatforms = existing.platforms || [];
            const mergedPlatforms = existingPlatforms.includes('PC')
              ? existingPlatforms
              : [...existingPlatforms, 'PC'];

            // Merge storefronts: add amazon if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('amazon')
              ? existingStorefronts
              : [...existingStorefronts, 'amazon'];

            const updateFields = {
              platforms: mergedPlatforms,
              storefronts: mergedStorefronts,
              updatedAt: new Date()
            };

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
          platforms: ['PC'],
          storefronts: ['amazon'],
          status: 'backlog',
          favorite: false,
          hoursPlayed: null,
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
