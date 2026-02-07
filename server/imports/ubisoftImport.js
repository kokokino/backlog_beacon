import { Meteor } from 'meteor/meteor';
import yaml from 'yaml';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';
import { fetchOwnedGamesViaDemux } from './ubisoftDemux.js';

// Ubisoft Connect API endpoints
const UBISOFT_SESSIONS_URL = 'https://public-ubiservices.ubi.com/v3/profiles/sessions';
const UBISOFT_GRAPHQL_URL = 'https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql';

// App ID for Ubisoft Connect (from ubisoft-demux-node)
const UBISOFT_APP_ID = 'f68a4bb5-608a-4ff2-8123-be8ef797e0a6';

// App ID for the Ubisoft Club/GraphQL endpoint (from GOG Galaxy integration)
const UBISOFT_CLUB_APP_ID = 'f35adcb5-1911-440c-b1c9-48fdc1701c68';

const UBISOFT_USER_AGENT = 'Massgate';

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
        lastError = new Error('Ubisoft API rate limited');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Return response for caller to handle status codes
      return response;
    } catch (error) {
      if (error instanceof Meteor.Error) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Meteor.Error('network-error', 'Could not connect to Ubisoft. Please try again later.');
}

// Authenticate with Ubisoft using email/password (Basic auth)
async function authenticateUbisoft(email, password) {
  const credentials = Buffer.from(`${email}:${password}`).toString('base64');

  const response = await fetchWithRetry(UBISOFT_SESSIONS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Ubi-AppId': UBISOFT_APP_ID,
      'Ubi-RequestedPlatformType': 'uplay',
      'User-Agent': UBISOFT_USER_AGENT,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ rememberMe: true })
  });

  if (response.status === 401 || response.status === 403) {
    throw new Meteor.Error('auth-invalid', 'Invalid email or password.');
  }

  if (!response.ok) {
    throw new Meteor.Error('auth-invalid', 'Invalid email or password.');
  }

  const data = await response.json();

  // Check if 2FA is required
  if (data.twoFactorAuthenticationTicket) {
    throw new Meteor.Error('auth-2fa-required', 'Two-factor authentication required.', data.twoFactorAuthenticationTicket);
  }

  if (!data.ticket || !data.sessionId) {
    throw new Meteor.Error('auth-invalid', 'Invalid email or password.');
  }

  return { ticket: data.ticket, sessionId: data.sessionId };
}

// Authenticate with Ubisoft 2FA code
async function authenticateUbisoft2FA(twoFactorTicket, code) {
  const response = await fetchWithRetry(UBISOFT_SESSIONS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `ubi_2fa_v1 t=${twoFactorTicket}`,
      'Ubi-AppId': UBISOFT_APP_ID,
      'Ubi-RequestedPlatformType': 'uplay',
      'Ubi-2faCode': code,
      'User-Agent': UBISOFT_USER_AGENT,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ rememberMe: true })
  });

  if (response.status === 401 || response.status === 403) {
    throw new Meteor.Error('auth-2fa-invalid', 'Invalid verification code. Please try again.');
  }

  if (!response.ok) {
    throw new Meteor.Error('auth-2fa-invalid', 'Invalid verification code. Please try again.');
  }

  const data = await response.json();

  if (!data.ticket || !data.sessionId) {
    throw new Meteor.Error('auth-2fa-invalid', 'Invalid verification code. Please try again.');
  }

  return { ticket: data.ticket, sessionId: data.sessionId };
}

// ---------------------------------------------------------------------------
// Ubisoft Club / GraphQL fallback
//
// Uses POST /v1/profiles/me/uplay/graphql to fetch the user's game library.
// Limitation: Only returns games the user has interacted with (launched/played
// via Ubisoft Connect), not the complete purchase history.
//
// For full ownership data, the Demux protocol (fetchUbisoftLibrary below) is
// the authoritative source — the same protocol the Ubisoft Connect desktop
// client uses. This GraphQL path is kept as a fallback in case the Demux
// protocol changes or becomes unavailable.
// ---------------------------------------------------------------------------

// Build the GraphQL query for fetching owned games with offset pagination
function buildOwnedGamesQuery(offset) {
  return {
    operationName: 'OwnedGames',
    variables: {},
    query: 'query OwnedGames {' +
      'viewer {' +
      '  id' +
      '  ownedGames: games(filterBy: {isOwned: true}, limit: 50, offset: ' + offset + ') {' +
      '    totalCount' +
      '    nodes {' +
      '      id' +
      '      spaceId' +
      '      name' +
      '    }' +
      '  }' +
      '}' +
      '}'
  };
}

// Fetch a single page of owned games
async function fetchUbisoftPage(ticket, sessionId, offset) {
  const payload = buildOwnedGamesQuery(offset);

  const response = await fetchWithRetry(UBISOFT_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Ubi_v1 t=${ticket}`,
      'Ubi-AppId': UBISOFT_CLUB_APP_ID,
      'Ubi-SessionId': sessionId,
      'User-Agent': UBISOFT_USER_AGENT,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Meteor.Error('auth-invalid', 'Ubisoft session expired. Please try again.');
  }

  if (!response.ok) {
    throw new Meteor.Error('api-error', `Ubisoft API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors && data.errors.length > 0) {
    throw new Meteor.Error('api-error', `Ubisoft API error: ${data.errors[0].message || 'Unknown error'}`);
  }

  const ownedGames = data?.data?.viewer?.ownedGames || data?.data?.viewer?.games;
  return {
    totalCount: ownedGames?.totalCount || 0,
    nodes: ownedGames?.nodes || []
  };
}

// Fetch all owned games with offset pagination (GraphQL fallback)
async function fetchUbisoftLibraryGraphQL(ticket, sessionId) {
  const allNodes = [];
  let offset = 0;
  let totalCount = 0;
  const pageSize = 50;
  const maxPages = 20; // Safety limit: 1000 games max

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchUbisoftPage(ticket, sessionId, offset);
    totalCount = result.totalCount;
    allNodes.push(...result.nodes);

    if (allNodes.length >= totalCount || result.nodes.length === 0) {
      break;
    }

    offset += pageSize;
  }

  return allNodes;
}

// Filter library items to only include actual games
function filterLibraryItems(items) {
  return items.filter(item => {
    if (!item.id || !item.name) {
      return false;
    }
    return true;
  });
}

// Check if a parsed name is a real title or a placeholder/localization key.
// Ubisoft uses placeholders like "l1", "NAME", "GAMENAME", "BACKGROUNDIMAGE" etc.
function isPlaceholderName(name) {
  if (!name || name.length <= 2) {
    return true;
  }
  const upper = name.toUpperCase();
  return upper === name && /^[A-Z]+$/.test(name);
}

// Parse game name from the YAML configuration field on an OwnedGame.
// Ubisoft configs use localization keys (e.g. name: l1) with real names in a
// localizations section. Falls back to comment headers and regex extraction.
function parseGameName(configuration, productId) {
  if (!configuration) {
    return `Unknown (${productId})`;
  }

  let parsed = null;

  // Try structured YAML parse first
  try {
    parsed = yaml.parse(configuration, { uniqueKeys: false, strict: false });
  } catch {
    // Fall through to regex fallback
  }

  const root = parsed && parsed.root ? parsed.root : null;

  // 1. root.name — if it's a real title (not a placeholder/localization key)
  if (root && root.name && !isPlaceholderName(root.name)) {
    return root.name;
  }

  // 2. Resolve localization key: if name is a key like "l1", look it up in
  //    root.localizations (e.g. localizations: { l1: "Assassin's Creed® Origins" })
  if (root && root.name && root.localizations) {
    const localized = resolveLocalizationKey(root.name, root.localizations);
    if (localized) {
      return localized;
    }
  }

  // 3. Top-level localizations (outside root)
  if (root && root.name && parsed && parsed.localizations) {
    const localized = resolveLocalizationKey(root.name, parsed.localizations);
    if (localized) {
      return localized;
    }
  }

  // 4. Comment header (e.g. "# ASSASSIN'S CREED 2" or "# Far Cry® 4")
  const commentMatch = configuration.match(/^#[-\s]*\n#\s*(.+?)\s*\n/);
  if (commentMatch && commentMatch[1].length > 2) {
    const raw = commentMatch[1].trim();
    // Title-case all-caps comments: "ASSASSIN'S CREED 2" → "Assassin's Creed 2"
    if (raw === raw.toUpperCase()) {
      return raw.replace(/\w\S*/g, word =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      );
    }
    return raw;
  }

  // 5. Regex fallback: name from raw text (skip placeholders)
  const nameMatch = configuration.match(/name:\s*"?([^"\n]+)"?/);
  if (nameMatch && !isPlaceholderName(nameMatch[1].trim())) {
    return nameMatch[1].trim();
  }

  return `Unknown (${productId})`;
}

// Resolve a localization key (e.g. "l1") from a localizations object.
// Structure is: localizations[locale][key] → string value
// e.g. localizations.default.l1 = "Assassin's Creed® Origins"
function resolveLocalizationKey(key, localizations) {
  if (!localizations || typeof localizations !== 'object') {
    return null;
  }

  // Try "default" locale first, then any other locale
  const locales = ['default', ...Object.keys(localizations).filter(l => l !== 'default')];
  for (const locale of locales) {
    const localeObj = localizations[locale];
    if (localeObj && typeof localeObj === 'object') {
      const value = localeObj[key];
      if (typeof value === 'string' && value.length > 2) {
        return value;
      }
    }
  }

  return null;
}

// Fetch owned games by merging Demux (primary) and GraphQL (supplementary) sources.
// Demux returns all owned products; GraphQL returns only played games but with clean names.
async function fetchUbisoftLibrary(ticket, sessionId) {
  const [demuxResult, graphqlResult] = await Promise.allSettled([
    fetchOwnedGamesViaDemux(ticket),
    fetchUbisoftLibraryGraphQL(ticket, sessionId)
  ]);

  const demuxOk = demuxResult.status === 'fulfilled';
  const graphqlOk = graphqlResult.status === 'fulfilled';

  if (!demuxOk && !graphqlOk) {
    throw new Meteor.Error('api-error', 'Failed to fetch Ubisoft library from both sources. Please try again.');
  }

  if (!demuxOk) {
    console.warn('[Ubisoft] Demux fetch failed, using GraphQL only:', demuxResult.reason?.message);
  }
  if (!graphqlOk) {
    console.warn('[Ubisoft] GraphQL fetch failed, using Demux only:', graphqlResult.reason?.message);
  }

  const rawDemuxGames = demuxOk ? demuxResult.value : [];
  const graphqlGames = graphqlOk ? graphqlResult.value : [];

  // Build GraphQL lookup by spaceId for O(1) name resolution
  const graphqlBySpaceId = new Map();
  for (const game of graphqlGames) {
    if (game.spaceId) {
      graphqlBySpaceId.set(game.spaceId, game);
    }
  }

  // Process Demux results: filter to actual games (productType === 0), exclude expired (state === 4)
  const mergedById = new Map();

  for (const game of rawDemuxGames) {
    if (game.productType !== 0) {
      continue;
    }
    if (game.state === 4) {
      continue;
    }

    const spaceId = game.ubiservicesSpaceId || null;
    const graphqlMatch = spaceId ? graphqlBySpaceId.get(spaceId) : null;
    const title = graphqlMatch ? graphqlMatch.name : parseGameName(game.configuration, game.productId);

    const entry = {
      id: String(game.productId),
      name: title,
      spaceId
    };

    const key = spaceId || entry.id;
    mergedById.set(key, entry);
  }

  // Add GraphQL-only games (played but not in Demux ownership data)
  let graphqlOnlyCount = 0;
  for (const game of graphqlGames) {
    if (game.spaceId && !mergedById.has(game.spaceId)) {
      mergedById.set(game.spaceId, {
        id: game.id || game.spaceId,
        name: game.name,
        spaceId: game.spaceId
      });
      graphqlOnlyCount++;
    }
  }

  const games = Array.from(mergedById.values());
  const demuxCount = games.length - graphqlOnlyCount;
  console.log(`[Ubisoft] Fetched ${games.length} games (${demuxCount} from Demux, ${graphqlGames.length} from GraphQL)`);

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

// Process import - following Oculus/Epic patterns
async function processUbisoftImport(userId, games, options) {
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
      const ubisoftGame = games[gameIndex];
      const gameName = ubisoftGame.title;

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

            // Merge storefronts: add ubisoft if not present
            const existingStorefronts = existing.storefronts || [];
            const mergedStorefronts = existingStorefronts.includes('ubisoft')
              ? existingStorefronts
              : [...existingStorefronts, 'ubisoft'];

            const updateFields = {
              platforms: mergedPlatforms,
              storefronts: mergedStorefronts,
              updatedAt: new Date()
            };

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
          storefronts: ['ubisoft'],
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

// Main import function (no 2FA)
export async function importUbisoftLibrary(userId, email, password, options = {}) {
  const { updateExisting = true } = options;

  // Authenticate with Ubisoft (may throw auth-2fa-required)
  const { ticket, sessionId } = await authenticateUbisoft(email, password);

  // Fetch library via Demux + GraphQL
  const allItems = await fetchUbisoftLibrary(ticket, sessionId);

  // Filter to only include actual games
  const gameItems = filterLibraryItems(allItems);

  if (gameItems.length === 0) {
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
  const games = gameItems.map(item => ({
    title: item.name,
    ubisoftId: item.id,
    spaceId: item.spaceId
  }));

  // Sort alphabetically for consistent UX
  games.sort((a, b) => a.title.localeCompare(b.title));

  return processUbisoftImport(userId, games, { updateExisting });
}

// Import with 2FA (second step after auth-2fa-required)
export async function importUbisoftLibraryWith2FA(userId, twoFactorTicket, code, options = {}) {
  const { updateExisting = true } = options;

  // Authenticate with 2FA code
  const { ticket, sessionId } = await authenticateUbisoft2FA(twoFactorTicket, code);

  // Fetch library via Demux + GraphQL
  const allItems = await fetchUbisoftLibrary(ticket, sessionId);

  // Filter to only include actual games
  const gameItems = filterLibraryItems(allItems);

  if (gameItems.length === 0) {
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
  const games = gameItems.map(item => ({
    title: item.name,
    ubisoftId: item.id,
    spaceId: item.spaceId
  }));

  // Sort alphabetically for consistent UX
  games.sort((a, b) => a.title.localeCompare(b.title));

  return processUbisoftImport(userId, games, { updateExisting });
}
