console.log('=== LOADING MIGRATION 8_denormalize_game_data.js ===');

import { Migrations } from 'meteor/quave:migrations';
import { Games } from '../../imports/lib/collections/games.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { buildEmbeddedGame } from '../lib/gameHelpers.js';

const BATCH_SIZE = 500;

Migrations.add({
  version: 8,
  name: 'Denormalize game data into collectionItems for faster queries',
  up: async function() {
    console.log('=== RUNNING MIGRATION 8: Denormalize game data ===');

    // Part A: Create indexes for efficient propagation and queries
    try {
      await CollectionItems.createIndexAsync({ gameId: 1 });
      console.log('✓ Created CollectionItems.gameId index');
    } catch (error) {
      console.log('CollectionItems.gameId index may already exist:', error.message);
    }

    try {
      await CollectionItems.createIndexAsync({ userId: 1, 'game.title': 1 });
      console.log('✓ Created CollectionItems.userId_game.title index');
    } catch (error) {
      console.log('CollectionItems.userId_game.title index may already exist:', error.message);
    }

    // Part B: Batch process all existing collectionItems
    const totalCount = await CollectionItems.countDocuments({});
    console.log(`Found ${totalCount} collection items to process`);

    if (totalCount === 0) {
      console.log('✓ No collection items to migrate');
      console.log('✓ Migration 8 completed successfully');
      return;
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;

    // Process in batches
    while (processed < totalCount) {
      // Fetch batch of items that don't have game embedded yet
      const items = await CollectionItems.find(
        { gameId: { $exists: true, $ne: null }, game: { $exists: false } },
        {
          fields: { _id: 1, gameId: 1 },
          limit: BATCH_SIZE
        }
      ).fetchAsync();

      if (items.length === 0) {
        // All remaining items either have game embedded or no gameId
        const remaining = await CollectionItems.countDocuments({ game: { $exists: false } });
        skipped += remaining;
        break;
      }

      // Get unique gameIds from this batch
      const gameIds = [...new Set(items.map(item => item.gameId))];

      // Fetch all games for this batch
      const games = await Games.find(
        { _id: { $in: gameIds } },
        {
          fields: {
            _id: 1,
            title: 1,
            releaseYear: 1,
            ownerId: 1,
            genres: 1,
            localCoverUrl: 1,
            coverImageId: 1,
            igdbCoverUrl: 1
          }
        }
      ).fetchAsync();

      // Create a map for quick lookup
      const gamesMap = new Map(games.map(game => [game._id, game]));

      // Build bulk operations
      const bulkOps = [];
      for (const item of items) {
        const game = gamesMap.get(item.gameId);
        const embeddedGame = buildEmbeddedGame(game);

        if (embeddedGame) {
          bulkOps.push({
            updateOne: {
              filter: { _id: item._id },
              update: { $set: { game: embeddedGame } }
            }
          });
        }
      }

      // Execute bulk update
      if (bulkOps.length > 0) {
        const rawCollection = CollectionItems.rawCollection();
        const result = await rawCollection.bulkWrite(bulkOps, { ordered: false });
        updated += result.modifiedCount || bulkOps.length;
      }

      processed += items.length;
      console.log(`Progress: ${processed}/${totalCount} items processed, ${updated} updated`);
    }

    console.log(`✓ Migration complete: ${updated} items updated, ${skipped} skipped (no gameId)`);
    console.log('✓ Migration 8 completed successfully');
  },
  down: async function() {
    console.log('Rolling back migration 8 - removing embedded game data');

    // Remove game subdocument from all collectionItems
    try {
      const result = await CollectionItems.updateAsync(
        {},
        { $unset: { game: '' } },
        { multi: true }
      );
      console.log(`✓ Removed game subdocument from ${result} collection items`);
    } catch (error) {
      console.log('Error removing game subdocument:', error.message);
    }

    // Drop the new indexes
    const rawCollection = CollectionItems.rawCollection();

    try {
      await rawCollection.dropIndex('userId_1_game.title_1');
      console.log('✓ Dropped CollectionItems.userId_game.title index');
    } catch (error) {
      console.log('userId_1_game.title_1 index may not exist:', error.message);
    }

    // Note: We don't drop gameId index as it may have existed before

    console.log('✓ Migration 8 rollback complete');
  }
});
