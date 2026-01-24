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

// Normalize a game name for comparison (handles semantic equivalents)
function normalizeForComparison(name) {
  let result = name.toLowerCase();

  // Replace fractions with words
  result = result.replace(/\b1\/2\b/g, 'half');
  result = result.replace(/\b1\/4\b/g, 'quarter');
  result = result.replace(/\b3\/4\b/g, 'three quarters');

  // Replace symbols with words
  result = result.replace(/&/g, ' and ');
  result = result.replace(/\+/g, ' and ');

  // Replace slash with "and" (but not in fractions which are already handled)
  result = result.replace(/\//g, ' and ');

  // Remove punctuation except spaces and numbers
  result = result.replace(/[^a-z0-9\s]/g, ' ');

  // Collapse spaces between numbers and letters (e.g., "8 doors" -> "8doors")
  result = result.replace(/(\d)\s+([a-z])/g, '$1$2');
  result = result.replace(/([a-z])\s+(\d)/g, '$1$2');

  // Collapse multiple spaces
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

// Calculate similarity score (0-100) between query and IGDB result
function calculateMatchScore(query, igdbName) {
  const queryLower = query.toLowerCase();
  const igdbLower = igdbName.toLowerCase();

  // Exact match
  if (queryLower === igdbLower) {
    return 100;
  }

  // IGDB name is a prefix of query (IGDB missing subtitle - different game in series)
  // e.g., query "Half-Life: Alyx", IGDB "Half-Life" - these are different games
  // Score low because IGDB is missing specificity the import has
  if (queryLower.startsWith(igdbLower + ':') ||
      queryLower.startsWith(igdbLower + ' -') ||
      queryLower.startsWith(igdbLower + ' –') ||
      queryLower.startsWith(igdbLower + '/')) {
    return 60;
  }

  // Query is a prefix of IGDB name (reverse case)
  if (igdbLower.startsWith(queryLower + ':') ||
      igdbLower.startsWith(queryLower + ' -') ||
      igdbLower.startsWith(queryLower + ' –')) {
    return 90;
  }

  // Normalize both strings for semantic comparison
  const queryNorm = normalizeForComparison(query);
  const igdbNorm = normalizeForComparison(igdbName);

  // Exact match after normalization
  if (queryNorm === igdbNorm) {
    return 98;
  }

  // Calculate Levenshtein on normalized strings
  const distance = levenshteinDistance(queryNorm, igdbNorm);
  const maxLen = Math.max(queryNorm.length, igdbNorm.length);
  const similarity = ((maxLen - distance) / maxLen) * 100;

  // Boost score if one contains the other (normalized)
  if (queryNorm.includes(igdbNorm) || igdbNorm.includes(queryNorm)) {
    return Math.max(similarity, 75);
  }

  return similarity;
}

// Generate search patterns for batched IGDB query
function getSearchPatterns(name) {
  const patterns = [];
  const escaped = name.replace(/"/g, '\\"').replace(/\\/g, '\\\\');

  // Pattern 1: Full name (using search syntax for relevance)
  patterns.push({ type: 'search', value: escaped });

  // Pattern 2: Name before colon (e.g., "Cat Quest II: The Lupus Empire" -> "Cat Quest II")
  if (name.includes(':')) {
    const beforeColon = name.split(':')[0].trim().replace(/"/g, '\\"');
    if (beforeColon.length >= 3) {
      patterns.push({ type: 'search', value: beforeColon });
    }
  }

  // Pattern 3: Name before dash (e.g., "Hundred Days - Winemaking Simulator" -> "Hundred Days")
  if (name.includes(' - ')) {
    const beforeDash = name.split(' - ')[0].trim().replace(/"/g, '\\"');
    if (beforeDash.length >= 3 && !patterns.some(p => p.value === beforeDash)) {
      patterns.push({ type: 'search', value: beforeDash });
    }
  }

  // Pattern 4: Replace "/" with " and " for search (e.g., "Zombies/Ghoul" -> "Zombies and Ghoul")
  if (name.includes('/') && !name.includes('://')) {
    const withAnd = name.replace(/\//g, ' and ').replace(/"/g, '\\"');
    if (!patterns.some(p => p.value === withAnd)) {
      patterns.push({ type: 'search', value: withAnd });
    }
  }

  // Pattern 5: For long names without clear delimiters, try first 2-3 words
  // (e.g., "WRC 8 FIA World Rally Championship" -> "WRC 8")
  const words = name.split(/\s+/);
  if (words.length >= 4 && !name.includes(':') && !name.includes(' - ')) {
    const shortName = words.slice(0, 2).join(' ').replace(/"/g, '\\"');
    if (shortName.length >= 3 && !patterns.some(p => p.value === shortName)) {
      patterns.push({ type: 'search', value: shortName });
    }
  }

  // Pattern 6: Collapse spaces between numbers and words (e.g., "8 Doors" -> "8Doors")
  const collapsed = name.replace(/(\d)\s+([a-zA-Z])/g, '$1$2').replace(/([a-zA-Z])\s+(\d)/g, '$1$2');
  if (collapsed !== name) {
    const collapsedEscaped = collapsed.replace(/"/g, '\\"');
    if (!patterns.some(p => p.value === collapsedEscaped)) {
      patterns.push({ type: 'search', value: collapsedEscaped });
    }
  }

  // Pattern 7: Normalized wildcard (1/2 -> half, / -> and)
  const normalized = normalizeForComparison(name);
  const normWords = normalized.split(' ').filter(w => w.length >= 2);
  if (normWords.length >= 2) {
    // Use first 2-3 significant words as wildcard pattern
    const wildcardPattern = normWords.slice(0, 3).join('*');
    patterns.push({ type: 'wildcard', value: wildcardPattern });
  }

  return patterns;
}

// Search for game by name with fuzzy matching (for imports)
export async function findGameByName(name, platform = null) {
  if (!name || name.trim().length === 0) {
    return null;
  }

  const originalName = name.trim();
  const patterns = getSearchPatterns(originalName);
  const allResults = [];

  // Get search patterns for hybrid search
  const searchPatterns = patterns.filter(p => p.type === 'search');

  // Phase 1: Sorted wildcard search - puts exact/shorter matches first alphabetically
  // This helps when IGDB's relevance ranking buries exact matches
  try {
    const sortedBody = `
      fields name, slug, summary, cover.image_id, platforms.name, genres.name,
             first_release_date, involved_companies.company.name, involved_companies.developer,
             involved_companies.publisher, rating, rating_count, updated_at, checksum;
      where name ~ *"${searchPatterns[0].value}"*;
      sort name asc;
      limit 25;
    `;
    const sortedResults = await makeRequest('games', sortedBody);
    // DEBUG: Log Phase 1 results
    // console.log(`\n=== IGDB Phase 1 for "${originalName}" ===`);
    // sortedResults.slice(0, 15).forEach((g, i) => {
    //   const score = calculateMatchScore(originalName, g.name);
    //   console.log(`  ${i + 1}. "${g.name}" (score: ${score})`);
    // });
    allResults.push(...sortedResults);
  } catch (error) {
    console.warn(`Sorted search failed:`, error.message);
  }

  // Phase 2: Relevance-ranked search - handles typos and fuzzy matching
  // Only if we don't have a great match yet
  if (!allResults.some(game => calculateMatchScore(originalName, game.name) >= 95)) {
    for (const pattern of searchPatterns) {
      try {
        const body = `
          search "${pattern.value}";
          fields name, slug, summary, cover.image_id, platforms.name, genres.name,
                 first_release_date, involved_companies.company.name, involved_companies.developer,
                 involved_companies.publisher, rating, rating_count, updated_at, checksum;
          limit 25;
        `;
        const results = await makeRequest('games', body);
        allResults.push(...results);

        // If we got good results, don't need more API calls
        const hasGoodMatch = results.some(game =>
          calculateMatchScore(originalName, game.name) >= 80
        );
        if (hasGoodMatch) {
          break;
        }
      } catch (error) {
        console.warn(`Search failed for "${pattern.value}":`, error.message);
      }
    }
  }

  if (allResults.length === 0) {
    return null;
  }

  // Deduplicate by IGDB ID
  const uniqueResults = [];
  const seenIds = new Set();
  for (const game of allResults) {
    if (!seenIds.has(game.id)) {
      seenIds.add(game.id);
      uniqueResults.push(game);
    }
  }

  // Score all results against the original name (uses normalized comparison)
  const scoredResults = uniqueResults.map(game => ({
    game,
    score: calculateMatchScore(originalName, game.name)
  }));

  // Sort by score descending
  scoredResults.sort((a, b) => b.score - a.score);

  const bestMatch = scoredResults[0];

  // DEBUG: Log top matches
  // console.log(`=== Best matches for "${originalName}" ===`);
  // scoredResults.slice(0, 5).forEach((r, i) => {
  //   console.log(`  ${i + 1}. "${r.game.name}" (score: ${r.score})`);
  // });
  // console.log(`  → Selected: "${bestMatch.game.name}"\n`);

  // Accept if score is good enough (> 50%)
  if (bestMatch.score >= 50) {
    // Platform matching: only consider if best match score is < 95
    // (don't override near-perfect/exact name matches due to platform data quirks)
    if (platform && scoredResults.length > 1 && bestMatch.score < 95) {
      const platformLower = platform.toLowerCase();
      const bestHasPlatform = bestMatch.game.platforms?.some(p =>
        p.name.toLowerCase().includes(platformLower)
      );

      // Only look for platform match if best doesn't already have it
      if (!bestHasPlatform) {
        const platformMatch = scoredResults.find(({ game, score }) =>
          score >= bestMatch.score - 10 && // Within 10 points of best
          game.platforms?.some(p => p.name.toLowerCase().includes(platformLower))
        );
        if (platformMatch) {
          // console.log(`  → Platform override: "${platformMatch.game.name}" has platform "${platform}"`);
          return platformMatch.game;
        }
      }
    }

    return bestMatch.game;
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
