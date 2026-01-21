console.log('=== LOADING MIGRATION 4_add_gamename_sort_index.js ===');

import { Migrations } from 'meteor/quave:migrations';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';

Migrations.add({
  version: 4,
  name: 'Add compound index for userId + gameName sorting',
  up: async function() {
    console.log('=== RUNNING MIGRATION 4: Add gameName sort index ===');

    // Compound index for efficient sorted queries by gameName
    try {
      await CollectionItems.createIndexAsync({ userId: 1, gameName: 1 });
      console.log('✓ Created CollectionItems.userId+gameName index');
    } catch (error) {
      console.log('CollectionItems.userId+gameName index may already exist:', error.message);
    }

    // Compound index for search + sort (gameName regex queries with userId filter)
    try {
      await CollectionItems.createIndexAsync({ userId: 1, gameName: 'text' });
      console.log('✓ Created CollectionItems.userId+gameName text index');
    } catch (error) {
      console.log('CollectionItems.userId+gameName text index may already exist:', error.message);
    }

    console.log('✓ Migration 4 completed successfully');
  },
  down: async function() {
    console.log('Rolling back migration 4 - indexes will remain (safe to keep)');
  }
});
