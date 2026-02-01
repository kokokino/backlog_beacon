import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { Games } from '../../imports/lib/collections/games.js';
import { getStorefrontById, findStorefrontByName } from '../../imports/lib/constants/storefronts.js';

// Escape a value for CSV
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  const stringValue = String(value);
  
  // If contains comma, newline, or quote, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  
  return stringValue;
}

// Format date for CSV
function formatDate(date) {
  if (!date) {
    return '';
  }
  
  const d = new Date(date);
  
  if (isNaN(d.getTime())) {
    return '';
  }
  
  return d.toISOString().split('T')[0];
}

// Parse CSV line
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
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

// Helper to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Export user's collection to CSV (chunked processing to reduce memory usage)
export async function exportCollectionCSV(userId) {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'Must be logged in to export');
  }

  const CHUNK_SIZE = 200;

  // Count total items first
  const totalCount = await CollectionItems.countDocuments({ userId });

  if (totalCount === 0) {
    throw new Meteor.Error('no-data', 'No collection items to export');
  }

  // CSV headers
  const headers = [
    'Name',
    'IGDB ID',
    'Platforms',
    'Storefronts',
    'Status',
    'Favorite',
    'Rating',
    'Hours Played',
    'Date Added',
    'Date Started',
    'Date Completed',
    'Notes',
    'Genres',
    'Developer',
    'Publisher',
    'Release Year'
  ];

  const rows = [headers.map(escapeCSV).join(',')];

  // Process in chunks to reduce memory usage
  let skip = 0;
  while (skip < totalCount) {
    const items = await CollectionItems.find(
      { userId },
      { limit: CHUNK_SIZE, skip }
    ).fetchAsync();

    if (items.length === 0) {
      break;
    }

    // Fetch only the games needed for this chunk (with field projection)
    const gameIds = items.map(item => item.gameId).filter(Boolean);
    const games = await Games.find(
      { _id: { $in: gameIds } },
      {
        fields: {
          _id: 1,
          title: 1,
          genres: 1,
          developer: 1,
          publisher: 1,
          releaseYear: 1
        }
      }
    ).fetchAsync();
    const gamesMap = new Map(games.map(game => [game._id, game]));

    for (const item of items) {
      const game = item.gameId ? gamesMap.get(item.gameId) : null;

      // Get storefront names
      const storefrontNames = (item.storefronts || [])
        .map(id => {
          const storefront = getStorefrontById(id);
          return storefront ? storefront.name : id;
        })
        .join(', ');

      // Get platforms
      const platforms = item.platforms || [];

      const row = [
        game?.title || 'Unknown Game',
        item.igdbId || '',
        platforms.join(', '),
        storefrontNames,
        item.status || '',
        item.favorite ? 'Yes' : 'No',
        item.rating || '',
        item.hoursPlayed || '',
        formatDate(item.dateAdded),
        formatDate(item.dateStarted),
        formatDate(item.dateCompleted),
        item.notes || '',
        game ? (game.genres || []).join(', ') : '',
        game ? game.developer : '',
        game ? game.publisher : '',
        game ? game.releaseYear : ''
      ];

      rows.push(row.map(escapeCSV).join(','));
    }

    skip += CHUNK_SIZE;
  }

  return rows.join('\n');
}

// Import from Backlog Beacon CSV format
export async function importBacklogBeaconCSV(userId, csvContent, options = {}) {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'Must be logged in to import');
  }
  
  const lines = csvContent.split('\n');
  
  if (lines.length === 0) {
    throw new Meteor.Error('invalid-csv', 'Empty CSV file');
  }
  
  const headers = parseCSVLine(lines[0]);
  
  // Validate headers
  const requiredHeaders = ['Name'];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  
  if (missingHeaders.length > 0) {
    throw new Meteor.Error('invalid-csv', `Missing required headers: ${missingHeaders.join(', ')}`);
  }
  
  const results = {
    total: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.length === 0) {
      continue;
    }
    
    results.total++;
    
    const values = parseCSVLine(line);
    const row = {};
    
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    
    try {
      const result = await importBacklogBeaconRow(userId, row, options);
      
      if (result.success) {
        if (result.action === 'updated') {
          results.updated++;
        } else {
          results.imported++;
        }
      } else {
        results.skipped++;
      }
    } catch (error) {
      results.skipped++;
      results.errors.push({
        row: i + 1,
        name: row.Name,
        error: error.message
      });
    }
  }
  
  return results;
}

// Import a single row from Backlog Beacon CSV
async function importBacklogBeaconRow(userId, row, options = {}) {
  const gameName = row.Name;

  if (!gameName || gameName.trim() === '') {
    return { success: false, error: 'No game name' };
  }

  // Parse IGDB ID if present
  const igdbId = row['IGDB ID'] ? parseInt(row['IGDB ID'], 10) : null;

  // Try to find the game in cache first
  let game = null;
  if (igdbId) {
    game = await Games.findOneAsync({ igdbId });
  }
  if (!game) {
    // Try to find by title match
    game = await Games.findOneAsync({
      title: { $regex: new RegExp(`^${escapeRegex(gameName)}$`, 'i') }
    });
  }

  // Check for existing collection item
  let existing = null;
  if (game) {
    existing = await CollectionItems.findOneAsync({ userId, gameId: game._id });
  }
  if (!existing && igdbId) {
    existing = await CollectionItems.findOneAsync({ userId, igdbId });
  }

  if (existing && options.skipDuplicates !== false) {
    return { success: false, error: 'Duplicate' };
  }

  // Parse storefronts
  const storefrontNames = row.Storefronts ? row.Storefronts.split(',').map(s => s.trim()) : [];
  const storefronts = [];

  for (const name of storefrontNames) {
    const storefront = findStorefrontByName(name);
    if (storefront) {
      storefronts.push(storefront.id);
    }
  }

  // Parse platforms
  const platforms = row.Platforms ? row.Platforms.split(',').map(p => p.trim()) : [];

  // Build collection item
  const collectionItem = {
    userId,
    gameId: game?._id || null,
    igdbId: igdbId,
    platforms: platforms,
    storefronts: storefronts,
    status: row.Status || 'backlog',
    favorite: row.Favorite === 'Yes',
    hoursPlayed: row['Hours Played'] ? parseFloat(row['Hours Played']) : null,
    dateStarted: row['Date Started'] ? new Date(row['Date Started']) : null,
    dateCompleted: row['Date Completed'] ? new Date(row['Date Completed']) : null,
    rating: row.Rating ? parseInt(row.Rating, 10) : null,
    notes: row.Notes || '',
    physical: false,
    dateAdded: row['Date Added'] ? new Date(row['Date Added']) : new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  if (existing && options.updateExisting === true) {
    await CollectionItems.updateAsync(existing._id, {
      $set: {
        ...collectionItem,
        createdAt: existing.createdAt
      }
    });
    return { success: true, action: 'updated' };
  }

  await CollectionItems.insertAsync(collectionItem);
  return { success: true, action: 'inserted' };
}
