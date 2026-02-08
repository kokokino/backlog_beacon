import { Meteor } from 'meteor/meteor';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { Games } from '../../imports/lib/collections/games.js';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';
import { getStorefrontById, findStorefrontByName } from '../../imports/lib/constants/storefronts.js';
import { parseCSVToObjects } from './csvParser.js';
import { searchAndCacheGame } from '../igdb/gameCache.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

// Update progress for export
async function updateExportProgress(userId, progressData) {
  await ImportProgress.upsertAsync(
    { userId, type: 'export' },
    {
      $set: {
        ...progressData,
        userId,
        type: 'export',
        updatedAt: new Date()
      }
    }
  );
}

// Update progress for Backlog Beacon import
async function updateBacklogProgress(userId, progressData) {
  await ImportProgress.upsertAsync(
    { userId, type: 'backlog' },
    {
      $set: {
        ...progressData,
        userId,
        type: 'backlog',
        updatedAt: new Date()
      }
    }
  );
}

// Escape a value for CSV
export function escapeCSV(value) {
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
export function formatDate(date) {
  if (!date) {
    return '';
  }
  
  const d = new Date(date);
  
  if (isNaN(d.getTime())) {
    return '';
  }
  
  return d.toISOString().split('T')[0];
}


// Helper to escape regex special characters
export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Export user's collection to CSV (cursor-based pagination with $lookup)
export async function exportCollectionCSV(userId) {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'Must be logged in to export');
  }

  const CHUNK_SIZE = 1000;
  const rawCollection = CollectionItems.rawCollection();

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

  // Initialize export progress
  await updateExportProgress(userId, {
    status: 'processing',
    current: 0,
    total: totalCount
  });

  // Cursor-based pagination with $lookup — 1 round-trip per chunk
  let lastId = null;
  let hasMore = true;
  while (hasMore) {
    const matchStage = lastId
      ? { $match: { userId, _id: { $gt: lastId } } }
      : { $match: { userId } };

    const pipeline = [
      matchStage,
      { $sort: { _id: 1 } },
      { $limit: CHUNK_SIZE },
      { $project: {
        gameId: 1, igdbId: 1, platforms: 1, storefronts: 1,
        status: 1, favorite: 1, rating: 1, hoursPlayed: 1,
        dateAdded: 1, dateStarted: 1, dateCompleted: 1, notes: 1
      }},
      { $lookup: {
        from: 'games',
        localField: 'gameId',
        foreignField: '_id',
        pipeline: [
          { $project: { title: 1, genres: 1, developer: 1, publisher: 1, releaseYear: 1 } }
        ],
        as: 'gameData'
      }}
    ];

    const items = await rawCollection.aggregate(pipeline).toArray();

    for (const item of items) {
      const game = item.gameData?.[0] || null;

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

    // Update export progress after each chunk (rows.length - 1 excludes header row)
    await updateExportProgress(userId, {
      status: 'processing',
      current: rows.length - 1,
      total: totalCount
    });

    hasMore = items.length === CHUNK_SIZE;
    if (hasMore) {
      lastId = items[items.length - 1]._id;
    }
  }

  // Mark export as complete
  await updateExportProgress(userId, {
    status: 'complete',
    current: totalCount,
    total: totalCount
  });

  return rows.join('\n');
}

// Import from Backlog Beacon CSV format
export async function importBacklogBeaconCSV(userId, csvContent, options = {}) {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'Must be logged in to import');
  }

  const rows = parseCSVToObjects(csvContent);

  if (rows.length === 0) {
    throw new Meteor.Error('invalid-csv', 'No valid rows found in CSV');
  }

  // Validate that Name header exists by checking first row
  if (!rows[0].hasOwnProperty('Name')) {
    throw new Meteor.Error('invalid-csv', 'Missing required header: Name');
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
  await updateBacklogProgress(userId, {
    status: 'processing',
    current: 0,
    total: rows.length,
    currentGame: '',
    imported: 0,
    updated: 0,
    skipped: 0
  });

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Update progress before processing each row
      await updateBacklogProgress(userId, {
        status: 'processing',
        current: i + 1,
        total: rows.length,
        currentGame: row.Name || 'Unknown',
        imported: results.imported,
        updated: results.updated,
        skipped: results.skipped
      });

      try {
        const result = await importBacklogBeaconRow(userId, row, options);

        if (result.success) {
          if (result.action === 'updated') {
            results.updated++;
            results.games.push({ name: row.Name, matchedName: result.matchedName, action: 'updated' });
          } else {
            results.imported++;
            results.games.push({ name: row.Name, matchedName: result.matchedName, action: 'imported' });
          }
        } else {
          results.skipped++;
          results.games.push({ name: row.Name, action: 'skipped', reason: result.error || 'Duplicate' });
        }
      } catch (error) {
        results.skipped++;
        results.errors.push({
          row: i + 2, // +2 for header row and 0-indexing
          name: row.Name,
          error: error.message
        });
        results.games.push({ name: row.Name, action: 'error', reason: error.message });
      }
    }

    // Mark as complete
    await updateBacklogProgress(userId, {
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
    await updateBacklogProgress(userId, {
      status: 'error',
      error: error.message
    });
    throw error;
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

  // Parse platforms early for IGDB matching
  const platforms = row.Platforms ? row.Platforms.split(',').map(p => p.trim()) : [];
  const primaryPlatform = platforms[0] || null;

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

  // If game not found locally, search IGDB and cache it (like Darkadia import does)
  if (!game) {
    try {
      game = await searchAndCacheGame(gameName, primaryPlatform);
    } catch (error) {
      console.warn(`IGDB search failed for "${gameName}":`, error.message);
    }
  }

  // Check for existing collection item
  let existing = null;
  if (game) {
    existing = await CollectionItems.findOneAsync({ userId, gameId: game._id });
  }
  if (!existing && igdbId) {
    existing = await CollectionItems.findOneAsync({ userId, igdbId });
  }

  if (existing && options.updateExisting !== true) {
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

  // Build collection item - only include gameId/igdbId if they have values (sparse index)
  const collectionItem = {
    userId,
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

  // Only set gameId/igdbId if found - omitting allows sparse index to work
  if (game?._id) {
    collectionItem.gameId = game._id;
    collectionItem.game = buildEmbeddedGame(game);
  }
  if (igdbId) {
    collectionItem.igdbId = igdbId;
  }

  if (existing && options.updateExisting === true) {
    await CollectionItems.updateAsync(existing._id, {
      $set: {
        ...collectionItem,
        createdAt: existing.createdAt
      }
    });
    return { success: true, action: 'updated', matchedName: game?.title || null };
  }

  await CollectionItems.insertAsync(collectionItem);
  return { success: true, action: 'inserted', matchedName: game?.title || null };
}

// Preview Backlog Beacon CSV import without actually importing
export async function previewBacklogBeaconImport(userId, csvContent) {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'Must be logged in to preview import');
  }

  const rows = parseCSVToObjects(csvContent);

  if (rows.length === 0) {
    throw new Meteor.Error('invalid-csv', 'No valid rows found in CSV');
  }

  // Validate that Name header exists
  if (!rows[0].hasOwnProperty('Name')) {
    throw new Meteor.Error('invalid-csv', 'Missing required header: Name');
  }

  const preview = {
    total: rows.length,
    games: []
  };

  // Only include first 50 games in preview
  const previewRows = rows.slice(0, 50);

  for (const row of previewRows) {
    const platforms = row.Platforms ? row.Platforms.split(',').map(p => p.trim()) : [];

    preview.games.push({
      name: row.Name,
      platforms: platforms,
      status: row.Status || 'backlog',
      favorite: row.Favorite === 'Yes'
    });
  }

  return preview;
}
