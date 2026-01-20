import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { findStorefrontByName } from '../../imports/lib/constants/storefronts.js';

// Parse CSV content into rows
function parseCSV(csvContent) {
  const lines = csvContent.split('\n');
  if (lines.length === 0) {
    return [];
  }
  
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) {
      continue;
    }
    
    const values = parseCSVLine(line);
    const row = {};
    
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    
    rows.push(row);
  }
  
  return rows;
}

// Parse a single CSV line handling quoted fields
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  values.push(current.trim());
  
  return values;
}

// Map Darkadia status to our status
function mapStatus(darkadiaRow) {
  if (darkadiaRow.Playing === '1') {
    return 'playing';
  }
  if (darkadiaRow.Finished === '1' || darkadiaRow.Mastered === '1' || darkadiaRow.Dominated === '1') {
    return 'completed';
  }
  if (darkadiaRow.Shelved === '1') {
    return 'abandoned';
  }
  if (darkadiaRow.Owned === '1' || darkadiaRow.Played === '1') {
    return 'backlog';
  }
  if (darkadiaRow.Loved === '1') {
    return 'wishlist';
  }
  return 'backlog';
}

// Parse storefronts from Tags field
function parseStorefronts(tagsString) {
  if (!tagsString) {
    return [];
  }
  
  const tags = tagsString.split(',').map(t => t.trim()).filter(Boolean);
  const storefronts = [];
  
  for (const tag of tags) {
    const storefront = findStorefrontByName(tag);
    if (storefront) {
      storefronts.push(storefront.id);
    }
  }
  
  return [...new Set(storefronts)]; // Remove duplicates
}

// Parse platforms from Platforms field
function parsePlatforms(platformsString) {
  if (!platformsString) {
    return [];
  }
  
  return platformsString.split(',').map(p => p.trim()).filter(Boolean);
}

// Parse date from Darkadia format (YYYY-MM-DD)
function parseDate(dateString) {
  if (!dateString || dateString === '') {
    return null;
  }
  
  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) {
    return null;
  }
  
  return date;
}

// Update progress in the database
async function updateProgress(userId, progressData) {
  await ImportProgress.upsertAsync(
    { userId, type: 'darkadia' },
    { 
      $set: {
        ...progressData,
        userId,
        type: 'darkadia',
        updatedAt: new Date()
      }
    }
  );
}

// Clear progress from the database
async function clearProgress(userId) {
  await ImportProgress.removeAsync({ userId, type: 'darkadia' });
}

// Import a single Darkadia row
async function importRow(userId, row, options = {}) {
  const gameName = row.Name;
  
  if (!gameName || gameName.trim() === '') {
    return { success: false, error: 'No game name', row };
  }
  
  // Get primary platform for better IGDB matching
  const platforms = parsePlatforms(row.Platforms);
  const primaryPlatform = platforms[0] || null;
  
  // Search for game in IGDB (with caching)
  let game = null;
  let igdbId = null;
  let gameId = null;
  
  try {
    game = await searchAndCacheGame(gameName, primaryPlatform);
    if (game) {
      igdbId = game.igdbId;
      gameId = game._id;
    }
  } catch (error) {
    console.warn(`IGDB search failed for "${gameName}":`, error.message);
  }
  
  // Check for existing collection item
  const existingQuery = { userId };
  
  if (gameId) {
    existingQuery.gameId = gameId;
  } else {
    existingQuery.gameName = gameName;
  }
  
  const existing = await CollectionItems.findOneAsync(existingQuery);
  
  if (existing && options.updateExisting !== true) {
    return { success: false, error: 'Duplicate', existing: existing._id, row };
  }
  
  // Parse storefronts from Tags and Copy source
  let storefronts = parseStorefronts(row.Tags);
  
  // Also check Copy source field
  if (row['Copy source']) {
    const sourceStorefront = findStorefrontByName(row['Copy source']);
    if (sourceStorefront && !storefronts.includes(sourceStorefront.id)) {
      storefronts.push(sourceStorefront.id);
    }
  }
  
  // Build notes from various fields
  const notesParts = [];
  
  if (row.Notes) {
    notesParts.push(row.Notes);
  }
  if (row['Copy notes']) {
    notesParts.push(`Copy notes: ${row['Copy notes']}`);
  }
  if (row.Review) {
    notesParts.push(`Review: ${row.Review}`);
  }
  
  const notes = notesParts.join('\n\n');
  
  // Create collection item
  const collectionItem = {
    userId,
    gameId: gameId || null,
    igdbId: igdbId || null,
    gameName: gameName,
    platform: primaryPlatform || '',
    platforms: platforms,
    storefronts: storefronts,
    status: mapStatus(row),
    favorite: row.Loved === '1',
    hoursPlayed: parseFloat(row['Time played']) || null,
    dateStarted: null,
    dateCompleted: parseDate(row['Date completed']) || parseDate(row['Date mastered']),
    rating: parseInt(row.Rating, 10) || null,
    notes: notes || '',
    physical: false,
    dateAdded: parseDate(row.Added) || new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  if (existing && options.updateExisting === true) {
    // Update existing item
    await CollectionItems.updateAsync(existing._id, { 
      $set: {
        ...collectionItem,
        createdAt: existing.createdAt // Preserve original creation date
      }
    });
    return { success: true, action: 'updated', itemId: existing._id, gameName };
  }
  
  // Insert new item
  const itemId = await CollectionItems.insertAsync(collectionItem);
  
  return { success: true, action: 'inserted', itemId, gameName, gameId };
}

// Main import function
export async function importDarkadiaCSV(userId, csvContent, options = {}) {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'Must be logged in to import');
  }
  
  const rows = parseCSV(csvContent);
  
  if (rows.length === 0) {
    throw new Meteor.Error('invalid-csv', 'No valid rows found in CSV');
  }
  
  const results = {
    total: rows.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    games: []
  };
  
  // Initialize progress
  await updateProgress(userId, {
    status: 'processing',
    current: 0,
    total: rows.length,
    currentGame: '',
    imported: 0,
    updated: 0,
    skipped: 0
  });
  
  try {
    // Process rows with rate limiting for IGDB
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Update progress before processing each row
      await updateProgress(userId, {
        status: 'processing',
        current: i + 1,
        total: rows.length,
        currentGame: row.Name || 'Unknown',
        imported: results.imported,
        updated: results.updated,
        skipped: results.skipped
      });
      
      try {
        const result = await importRow(userId, row, options);
        
        if (result.success) {
          if (result.action === 'updated') {
            results.updated++;
          } else {
            results.imported++;
          }
          results.games.push({
            name: result.gameName,
            itemId: result.itemId,
            gameId: result.gameId,
            action: result.action
          });
        } else {
          results.skipped++;
          if (result.error !== 'Duplicate') {
            results.errors.push({
              row: i + 2, // +2 for header row and 0-indexing
              name: row.Name,
              error: result.error
            });
          }
        }
      } catch (error) {
        results.skipped++;
        results.errors.push({
          row: i + 2,
          name: row.Name,
          error: error.message
        });
      }
      
      // Progress callback if provided
      if (options.onProgress) {
        options.onProgress({
          current: i + 1,
          total: rows.length,
          imported: results.imported,
          skipped: results.skipped
        });
      }
    }
    
    // Mark as complete
    await updateProgress(userId, {
      status: 'complete',
      current: rows.length,
      total: rows.length,
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

// Preview import without actually importing
export async function previewDarkadiaImport(userId, csvContent) {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'Must be logged in to preview import');
  }
  
  const rows = parseCSV(csvContent);
  
  if (rows.length === 0) {
    throw new Meteor.Error('invalid-csv', 'No valid rows found in CSV');
  }
  
  const preview = {
    total: rows.length,
    games: []
  };
  
  // Just parse the first 50 rows for preview
  const previewRows = rows.slice(0, 50);
  
  for (const row of previewRows) {
    const platforms = parsePlatforms(row.Platforms);
    const storefronts = parseStorefronts(row.Tags);
    
    preview.games.push({
      name: row.Name,
      platforms: platforms,
      storefronts: storefronts,
      status: mapStatus(row),
      favorite: row.Loved === '1',
      dateAdded: row.Added,
      notes: row.Notes || ''
    });
  }
  
  return preview;
}

// Export clearProgress for use in methods
export { clearProgress };
