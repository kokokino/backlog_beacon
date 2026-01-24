import { Meteor } from 'meteor/meteor';
import { waitForRateLimit } from '../lib/distributedRateLimit.js';

// IGDB API client with distributed rate limiting
// Rate limit: 4 requests per second (shared across all instances)

const RATE_LIMIT_REQUESTS = 4;
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_BATCH_SIZE = 500;

let accessToken = null;
let tokenExpiresAt = null;

// Get Twitch OAuth token for IGDB API
async function getAccessToken() {
  const now = Date.now();
  
  // Return cached token if still valid (with 5 minute buffer)
  if (accessToken && tokenExpiresAt && now < tokenExpiresAt - 300000) {
    return accessToken;
  }
  
  const clientId = Meteor.settings.private?.igdb?.clientId;
  const clientSecret = Meteor.settings.private?.igdb?.clientSecret;
  
  if (!clientId || !clientSecret) {
    throw new Meteor.Error('igdb-not-configured', 'IGDB credentials not configured in settings');
  }
  
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Meteor.Error('igdb-auth-failed', `Failed to get IGDB access token: ${errorText}`);
  }
  
  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in * 1000);
  
  console.log('IGDB: Obtained new access token, expires in', data.expires_in, 'seconds');
  
  return accessToken;
}

// Rate-limited request to IGDB API (distributed across all instances)
async function makeRequest(endpoint, body) {
  const token = await getAccessToken();
  const clientId = Meteor.settings.private?.igdb?.clientId;

  // Distributed rate limiting - waits until a slot is available
  // This ensures all instances combined don't exceed 4 req/sec
  await waitForRateLimit('igdb', RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS);

  const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain'
    },
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Meteor.Error('igdb-request-failed', `IGDB API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Search for games by name
export async function searchGames(query, limit = 20) {
  if (!query || query.trim().length < 2) {
    return [];
  }
  
  const sanitizedQuery = query.replace(/"/g, '\\"');
  
  const body = `
    search "${sanitizedQuery}";
    fields name, slug, summary, cover.image_id, platforms.name, genres.name, 
           first_release_date, involved_companies.company.name, involved_companies.developer,
           involved_companies.publisher, rating, rating_count, aggregated_rating,
           aggregated_rating_count, updated_at, checksum;
    limit ${Math.min(limit, 50)};
  `;
  
  return makeRequest('games', body);
}

// Get game by IGDB ID
export async function getGameById(igdbId) {
  const body = `
    fields name, slug, summary, storyline, cover.image_id, 
           platforms.id, platforms.name, 
           genres.id, genres.name,
           themes.id, themes.name,
           first_release_date, 
           involved_companies.company.id, involved_companies.company.name, 
           involved_companies.developer, involved_companies.publisher,
           rating, rating_count, aggregated_rating, aggregated_rating_count,
           updated_at, checksum;
    where id = ${igdbId};
  `;
  
  const results = await makeRequest('games', body);
  return results.length > 0 ? results[0] : null;
}

// Get multiple games by IGDB IDs (batched)
export async function getGamesByIds(igdbIds) {
  if (!igdbIds || igdbIds.length === 0) {
    return [];
  }
  
  const allResults = [];
  
  // Process in batches of MAX_BATCH_SIZE
  for (let i = 0; i < igdbIds.length; i += MAX_BATCH_SIZE) {
    const batchIds = igdbIds.slice(i, i + MAX_BATCH_SIZE);
    const idsString = batchIds.join(',');
    
    const body = `
      fields name, slug, summary, storyline, cover.image_id, 
             platforms.id, platforms.name, 
             genres.id, genres.name,
             themes.id, themes.name,
             first_release_date, 
             involved_companies.company.id, involved_companies.company.name, 
             involved_companies.developer, involved_companies.publisher,
             rating, rating_count, aggregated_rating, aggregated_rating_count,
             updated_at, checksum;
      where id = (${idsString});
      limit ${MAX_BATCH_SIZE};
    `;
    
    const results = await makeRequest('games', body);
    allResults.push(...results);
  }
  
  return allResults;
}

// Levenshtein distance for fuzzy string matching
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;

  // Create a matrix
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize first column and row
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

// Calculate similarity score (0-100) between query and IGDB result
function calculateMatchScore(query, igdbName) {
  const queryLower = query.toLowerCase();
  const igdbLower = igdbName.toLowerCase();

  // Exact match
  if (queryLower === igdbLower) {
    return 100;
  }

  // IGDB name is a prefix of query (handles subtitle cases)
  // e.g., "Cat Quest II" matches "Cat Quest II: The Lupus Empire"
  if (queryLower.startsWith(igdbLower + ':') ||
      queryLower.startsWith(igdbLower + ' -') ||
      queryLower.startsWith(igdbLower + ' –') ||
      queryLower.startsWith(igdbLower + '/')) {
    return 95;
  }

  // Query is a prefix of IGDB name (reverse case)
  if (igdbLower.startsWith(queryLower + ':') ||
      igdbLower.startsWith(queryLower + ' -') ||
      igdbLower.startsWith(queryLower + ' –')) {
    return 90;
  }

  // Calculate Levenshtein-based similarity
  const distance = levenshteinDistance(queryLower, igdbLower);
  const maxLen = Math.max(queryLower.length, igdbLower.length);
  const similarity = ((maxLen - distance) / maxLen) * 100;

  // Boost score if one contains the other
  if (queryLower.includes(igdbLower) || igdbLower.includes(queryLower)) {
    return Math.max(similarity, 70);
  }

  return similarity;
}

// Generate simplified search variants from a game name
function getSearchVariants(name) {
  const variants = [name];

  // Strip subtitle after colon (e.g., "Cat Quest II: The Lupus Empire" -> "Cat Quest II")
  if (name.includes(':')) {
    variants.push(name.split(':')[0].trim());
  }

  // Strip subtitle after dash with spaces (e.g., "Hundred Days - Winemaking Simulator" -> "Hundred Days")
  if (name.includes(' - ')) {
    variants.push(name.split(' - ')[0].trim());
  }

  // Handle en-dash
  if (name.includes(' – ')) {
    variants.push(name.split(' – ')[0].trim());
  }

  // Handle slash notation (e.g., "Zombies Ate My Neighbors/Ghoul Patrol")
  if (name.includes('/') && !name.includes('://')) {
    variants.push(name.replace(/\//g, ' and '));
  }

  // Remove unique variants only
  return [...new Set(variants)];
}

// Search for game by name with fuzzy matching (for imports)
export async function findGameByName(name, platform = null) {
  if (!name || name.trim().length === 0) {
    return null;
  }

  const originalName = name.trim();
  const searchVariants = getSearchVariants(originalName);

  // Try each search variant
  for (const searchName of searchVariants) {
    const sanitizedName = searchName.replace(/"/g, '\\"');

    const body = `
      search "${sanitizedName}";
      fields name, slug, summary, cover.image_id, platforms.name, genres.name,
             first_release_date, involved_companies.company.name, involved_companies.developer,
             involved_companies.publisher, rating, rating_count, updated_at, checksum;
      limit 10;
    `;

    const results = await makeRequest('games', body);

    if (results.length === 0) {
      continue;
    }

    // Score all results against the original name
    const scoredResults = results.map(game => ({
      game,
      score: calculateMatchScore(originalName, game.name)
    }));

    // Sort by score descending
    scoredResults.sort((a, b) => b.score - a.score);

    const bestMatch = scoredResults[0];

    // Accept if score is good enough (> 50%)
    if (bestMatch.score >= 50) {
      // If platform specified, check if there's a better platform match with similar score
      if (platform && scoredResults.length > 1) {
        const platformLower = platform.toLowerCase();
        const platformMatch = scoredResults.find(({ game, score }) =>
          score >= bestMatch.score - 10 && // Within 10 points of best
          game.platforms?.some(p => p.name.toLowerCase().includes(platformLower))
        );
        if (platformMatch) {
          return platformMatch.game;
        }
      }

      return bestMatch.game;
    }
  }

  return null;
}

// Get cover image URL from IGDB
export function getCoverUrl(imageId, size = 'cover_big') {
  // Size options: cover_small (90x128), cover_big (264x374), 720p, 1080p
  if (!imageId) {
    return null;
  }
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

// Check if IGDB is configured
export function isConfigured() {
  const clientId = Meteor.settings.private?.igdb?.clientId;
  const clientSecret = Meteor.settings.private?.igdb?.clientSecret;
  return !!(clientId && clientSecret);
}
