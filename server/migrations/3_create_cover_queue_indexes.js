import { Migrations } from 'meteor/quave:migrations';
import { CoverQueue } from '../covers/coverQueue.js';

Migrations.add({
  version: 3,
  name: 'Create indexes for CoverQueue collection',
  up: async function() {
    console.log('=== RUNNING MIGRATION 3: Create CoverQueue indexes ===');
    
    // Index for finding pending items by priority and creation time
    try {
      await CoverQueue.createIndexAsync(
        { status: 1, priority: 1, createdAt: 1 },
        { name: 'status_priority_createdAt' }
      );
      console.log('✓ Created CoverQueue status_priority_createdAt index');
    } catch (error) {
      console.log('CoverQueue status_priority_createdAt index may already exist:', error.message);
    }
    
    // Index for finding items by gameId (to check for duplicates)
    try {
      await CoverQueue.createIndexAsync(
        { gameId: 1, status: 1 },
        { name: 'gameId_status' }
      );
      console.log('✓ Created CoverQueue gameId_status index');
    } catch (error) {
      console.log('CoverQueue gameId_status index may already exist:', error.message);
    }
    
    // Index for cleanup of old completed/failed items
    try {
      await CoverQueue.createIndexAsync(
        { status: 1, updatedAt: 1 },
        { name: 'status_updatedAt' }
      );
      console.log('✓ Created CoverQueue status_updatedAt index');
    } catch (error) {
      console.log('CoverQueue status_updatedAt index may already exist:', error.message);
    }
    
    console.log('=== MIGRATION 3 COMPLETE ===');
  },
  
  down: async function() {
    console.log('Rolling back migration 3 - indexes will remain (safe to keep)');
    // We don't drop indexes on rollback as they don't hurt and may be needed
  }
});
