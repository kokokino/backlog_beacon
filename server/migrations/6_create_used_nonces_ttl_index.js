import { Migrations } from 'meteor/quave:migrations';
import { UsedNonces } from '../../imports/lib/collections/usedNonces.js';

Migrations.add({
  version: 6,
  name: 'Create TTL index for UsedNonces collection',
  up: async function() {
    console.log('=== RUNNING MIGRATION 6: Create UsedNonces TTL index ===');

    // TTL index automatically deletes documents 600 seconds (10 minutes) after createdAt
    try {
      await UsedNonces.rawCollection().createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 600, name: 'createdAt_ttl' }
      );
      console.log('✓ Created UsedNonces TTL index (expires after 10 minutes)');
    } catch (error) {
      console.log('UsedNonces TTL index may already exist:', error.message);
    }

    console.log('=== MIGRATION 6 COMPLETE ===');
  },

  down: async function() {
    console.log('Rolling back migration 6 - TTL index will remain (safe to keep)');
  }
});
