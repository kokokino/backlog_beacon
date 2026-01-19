console.log('=== LOADING MIGRATION 1_create_indexes.js ===');

import { Migrations } from 'meteor/quave:migrations';
import { Games } from '../../imports/lib/collections/games.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';

Migrations.add({
  version: 1,
  name: 'Create indexes for Games and CollectionItems collections',
  up: async function() {
    console.log('=== RUNNING MIGRATION 1: Create indexes ===');
    
    // Games collection indexes
    try {
      await Games.createIndexAsync({ igdbId: 1 }, { unique: true, sparse: true });
      console.log('✓ Created Games.igdbId index');
    } catch (error) {
      console.log('Games.igdbId index may already exist:', error.message);
    }
    
    try {
      await Games.createIndexAsync({ searchName: 1 });
      console.log('✓ Created Games.searchName index');
    } catch (error) {
      console.log('Games.searchName index may already exist:', error.message);
    }
    
    try {
      await Games.createIndexAsync({ slug: 1 });
      console.log('✓ Created Games.slug index');
    } catch (error) {
      console.log('Games.slug index may already exist:', error.message);
    }
    
    try {
      await Games.createIndexAsync({ platforms: 1 });
      console.log('✓ Created Games.platforms index');
    } catch (error) {
      console.log('Games.platforms index may already exist:', error.message);
    }
    
    try {
      await Games.createIndexAsync({ genres: 1 });
      console.log('✓ Created Games.genres index');
    } catch (error) {
      console.log('Games.genres index may already exist:', error.message);
    }
    
    try {
      await Games.createIndexAsync({ releaseYear: 1 });
      console.log('✓ Created Games.releaseYear index');
    } catch (error) {
      console.log('Games.releaseYear index may already exist:', error.message);
    }
    
    try {
      await Games.createIndexAsync({ updatedAt: 1 });
      console.log('✓ Created Games.updatedAt index');
    } catch (error) {
      console.log('Games.updatedAt index may already exist:', error.message);
    }
    
    try {
      await Games.createIndexAsync(
        { title: 'text', name: 'text', searchName: 'text' },
        { name: 'games_text_search' }
      );
      console.log('✓ Created Games text search index');
    } catch (error) {
      console.log('Games text search index may already exist:', error.message);
    }
    
    // CollectionItems collection indexes
    try {
      await CollectionItems.createIndexAsync({ userId: 1 });
      console.log('✓ Created CollectionItems.userId index');
    } catch (error) {
      console.log('CollectionItems.userId index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync(
        { userId: 1, gameId: 1 },
        { unique: true, sparse: true }
      );
      console.log('✓ Created CollectionItems.userId+gameId index');
    } catch (error) {
      console.log('CollectionItems.userId+gameId index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync({ userId: 1, igdbId: 1 });
      console.log('✓ Created CollectionItems.userId+igdbId index');
    } catch (error) {
      console.log('CollectionItems.userId+igdbId index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync({ userId: 1, status: 1 });
      console.log('✓ Created CollectionItems.userId+status index');
    } catch (error) {
      console.log('CollectionItems.userId+status index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync({ userId: 1, favorite: 1 });
      console.log('✓ Created CollectionItems.userId+favorite index');
    } catch (error) {
      console.log('CollectionItems.userId+favorite index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync({ userId: 1, platforms: 1 });
      console.log('✓ Created CollectionItems.userId+platforms index');
    } catch (error) {
      console.log('CollectionItems.userId+platforms index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync({ userId: 1, storefronts: 1 });
      console.log('✓ Created CollectionItems.userId+storefronts index');
    } catch (error) {
      console.log('CollectionItems.userId+storefronts index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync({ gameId: 1 });
      console.log('✓ Created CollectionItems.gameId index');
    } catch (error) {
      console.log('CollectionItems.gameId index may already exist:', error.message);
    }
    
    try {
      await CollectionItems.createIndexAsync({ gameName: 1 });
      console.log('✓ Created CollectionItems.gameName index');
    } catch (error) {
      console.log('CollectionItems.gameName index may already exist:', error.message);
    }
    
    console.log('✓ Migration 1 completed successfully');
  },
  down: async function() {
    console.log('Rolling back migration 1 - indexes will remain (safe to keep)');
    // We don't drop indexes on rollback as they don't hurt and may be needed
  }
});
