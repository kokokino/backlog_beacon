console.log('=== LOADING MIGRATION 7_schema_cleanup.js ===');

import { Migrations } from 'meteor/quave:migrations';
import { Games } from '../../imports/lib/collections/games.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';

Migrations.add({
  version: 7,
  name: 'Schema cleanup: add ownerId, remove deprecated fields, consolidate platforms',
  up: async function() {
    console.log('=== RUNNING MIGRATION 7: Schema cleanup ===');

    // Part A: Games - Add ownerId sparse index for custom games
    try {
      await Games.createIndexAsync({ ownerId: 1 }, { sparse: true });
      console.log('✓ Created Games.ownerId sparse index');
    } catch (error) {
      console.log('Games.ownerId index may already exist:', error.message);
    }

    // Part B: Games - Remove name and searchName fields from all documents
    try {
      const gamesResult = await Games.updateAsync(
        {},
        { $unset: { name: '', searchName: '' } },
        { multi: true }
      );
      console.log(`✓ Removed name/searchName from ${gamesResult} game documents`);
    } catch (error) {
      console.log('Error removing name/searchName from games:', error.message);
    }

    // Part B2: Update text search index to only include title
    try {
      // First try to drop the old text search index
      const rawCollection = Games.rawCollection();
      try {
        await rawCollection.dropIndex('games_text_search');
        console.log('✓ Dropped old games_text_search index');
      } catch (dropError) {
        // Index might not exist or have different name
        console.log('Could not drop games_text_search (may not exist):', dropError.message);
      }

      // Create new text search index on title only
      await Games.createIndexAsync(
        { title: 'text' },
        { name: 'games_text_search' }
      );
      console.log('✓ Created new Games text search index (title only)');
    } catch (error) {
      console.log('Error updating text search index:', error.message);
    }

    // Part C: CollectionItems - Consolidate platform to platforms array
    try {
      // Find all items where platform exists
      const cursor = CollectionItems.find({ platform: { $exists: true } });
      let migratedCount = 0;
      let removedCount = 0;

      await cursor.forEachAsync(async (item) => {
        if (item.platform && item.platform.trim() !== '') {
          // Merge platform into platforms array if not already present
          await CollectionItems.updateAsync(item._id, {
            $addToSet: { platforms: item.platform },
            $unset: { platform: '' }
          });
          migratedCount++;
        } else {
          // Just remove the empty/null platform field
          await CollectionItems.updateAsync(item._id, {
            $unset: { platform: '' }
          });
          removedCount++;
        }
      });

      console.log(`✓ Migrated platform to platforms for ${migratedCount} items`);
      console.log(`✓ Removed empty platform field from ${removedCount} items`);
    } catch (error) {
      console.log('Error consolidating platform to platforms:', error.message);
    }

    // Part D: CollectionItems - Remove gameName field
    try {
      const itemsResult = await CollectionItems.updateAsync(
        {},
        { $unset: { gameName: '' } },
        { multi: true }
      );
      console.log(`✓ Removed gameName from ${itemsResult} collection items`);
    } catch (error) {
      console.log('Error removing gameName from collection items:', error.message);
    }

    // Part D2: Drop gameName-related indexes
    const rawItemsCollection = CollectionItems.rawCollection();

    try {
      await rawItemsCollection.dropIndex('gameName_1');
      console.log('✓ Dropped CollectionItems.gameName index');
    } catch (error) {
      console.log('gameName_1 index may not exist:', error.message);
    }

    try {
      await rawItemsCollection.dropIndex('userId_1_gameName_1');
      console.log('✓ Dropped CollectionItems.userId_gameName index');
    } catch (error) {
      console.log('userId_1_gameName_1 index may not exist:', error.message);
    }

    // Note: Text indexes can't be dropped by field name, need to find actual name
    try {
      const indexes = await rawItemsCollection.indexes();
      for (const index of indexes) {
        if (index.key && index.key._fts === 'text' && index.key.gameName) {
          await rawItemsCollection.dropIndex(index.name);
          console.log(`✓ Dropped CollectionItems text index: ${index.name}`);
        }
      }
    } catch (error) {
      console.log('Error dropping text index:', error.message);
    }

    console.log('✓ Migration 7 completed successfully');
  },
  down: async function() {
    console.log('Rolling back migration 7 - this will recreate old indexes but not restore data');

    // Recreate old text search index
    try {
      const rawCollection = Games.rawCollection();
      try {
        await rawCollection.dropIndex('games_text_search');
      } catch (dropError) {
        // Ignore
      }

      await Games.createIndexAsync(
        { title: 'text', name: 'text', searchName: 'text' },
        { name: 'games_text_search' }
      );
      console.log('✓ Recreated old Games text search index');
    } catch (error) {
      console.log('Error recreating text search index:', error.message);
    }

    // Recreate gameName index
    try {
      await CollectionItems.createIndexAsync({ gameName: 1 });
      console.log('✓ Recreated CollectionItems.gameName index');
    } catch (error) {
      console.log('Error recreating gameName index:', error.message);
    }

    console.log('Note: Data (name, searchName, gameName values) cannot be restored');
  }
});
