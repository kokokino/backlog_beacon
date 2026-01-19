import { Meteor } from 'meteor/meteor';

// IGDB API client with rate limiting
// Rate limit: 4 requests per second
// We use a token bucket approach

const RATE_LIMIT_REQUESTS = 4;
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_BATCH_SIZE = 500;

let accessToken = null;
let tokenExpiresAt = null;
let lastRequestTime = 0;
let requestsInWindow = 0;

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

// Rate-limited request to IGDB API
async function makeRequest(endpoint, body) {
  const token = await getAccessToken();
  const clientId = Meteor.settings.private?.igdb?.clientId;
  
  // Rate limiting
  const now = Date.now();
  if (now - lastRequestTime > RATE_LIMIT_WINDOW_MS) {
    requestsInWindow = 0;
    lastRequestTime = now;
  }
  
  if (requestsInWindow >= RATE_LIMIT_REQUESTS) {
    const waitTime = RATE_LIMIT_WINDOW_MS - (now - lastRequestTime);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    requestsInWindow = 0;
    lastRequestTime = Date.now();
  }
  
  requestsInWindow++;
  
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

// Search for game by exact name (for imports)
export async function findGameByName(name, platform = null) {
  if (!name || name.trim().length === 0) {
    return null;
  }
  
  const sanitizedName = name.replace(/"/g, '\\"').trim();
  
  const body = `
    search "${sanitizedName}";
    fields name, slug, summary, cover.image_id, platforms.name, genres.name, 
           first_release_date, involved_companies.company.name, involved_companies.developer,
           involved_companies.publisher, rating, rating_count, updated_at, checksum;
    limit 10;
  `;
  
  const results = await makeRequest('games', body);
  
  if (results.length === 0) {
    return null;
  }
  
  // Try to find exact match first
  const exactMatch = results.find(game => 
    game.name.toLowerCase() === sanitizedName.toLowerCase()
  );
  
  if (exactMatch) {
    return exactMatch;
  }
  
  // If platform specified, try to match by platform
  if (platform && results.length > 1) {
    const platformLower = platform.toLowerCase();
    const platformMatch = results.find(game => 
      game.platforms?.some(p => p.name.toLowerCase().includes(platformLower))
    );
    if (platformMatch) {
      return platformMatch;
    }
  }
  
  // Return first result as best guess
  return results[0];
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
