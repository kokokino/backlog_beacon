console.log('=== LOADING MIGRATION 5_add_game_title_name_indexes.js ===');

import { Migrations } from 'meteor/quave:migrations';
import { Games } from '../../imports/lib/collections/games.js';

Migrations.add({
  version: 5,
  name: 'Add indexes for game title and name sorting',
  up: async function() {
    console.log('=== RUNNING MIGRATION 5: Add game title/name indexes ===');

    // Index on title for sorting
    try {
      await Games.createIndexAsync(
        { title: 1 },
        { collation: { locale: 'en', strength: 2 } }
      );
      console.log('✓ Created Games.title index with collation');
    } catch (error) {
      console.log('Games.title index may already exist:', error.message);
    }

    // Index on name for secondary sorting
    try {
      await Games.createIndexAsync(
        { name: 1 },
        { collation: { locale: 'en', strength: 2 } }
      );
      console.log('✓ Created Games.name index with collation');
    } catch (error) {
      console.log('Games.name index may already exist:', error.message);
    }

    // Compound index for title + name sorting
    try {
      await Games.createIndexAsync(
        { title: 1, name: 1 },
        { collation: { locale: 'en', strength: 2 } }
      );
      console.log('✓ Created Games.title+name compound index with collation');
    } catch (error) {
      console.log('Games.title+name index may already exist:', error.message);
    }

    console.log('✓ Migration 5 completed successfully');
  },
  down: async function() {
    console.log('Rolling back migration 5 - indexes will remain (safe to keep)');
  }
});
