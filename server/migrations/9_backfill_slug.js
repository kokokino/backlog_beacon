console.log('=== LOADING MIGRATION 9_backfill_slug.js ===');

import { Migrations } from 'meteor/quave:migrations';
import { Games } from '../../imports/lib/collections/games.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';

const BATCH_SIZE = 500;

Migrations.add({
  version: 9,
  name: 'Backfill slug into denormalized game data on collectionItems',
  up: async function() {
    console.log('=== RUNNING MIGRATION 9: Backfill slug ===');

    let processed = 0;
    let updated = 0;
    let hasMore = true;

    while (hasMore) {
      // Fetch batch of items that have a gameId but no game.slug
      const items = await CollectionItems.find(
        { gameId: { $exists: true, $ne: null }, 'game.slug': { $exists: false } },
        {
          fields: { _id: 1, gameId: 1 },
          limit: BATCH_SIZE
        }
      ).fetchAsync();

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      // Get unique gameIds from this batch
      const gameIds = [...new Set(items.map(item => item.gameId))];

      // Fetch slugs for all games in this batch
      const games = await Games.find(
        { _id: { $in: gameIds } },
        { fields: { _id: 1, slug: 1 } }
      ).fetchAsync();

      const slugMap = new Map(games.map(game => [game._id, game.slug || null]));

      // Build bulk operations
      const bulkOps = [];
      for (const item of items) {
        const slug = slugMap.get(item.gameId);
        bulkOps.push({
          updateOne: {
            filter: { _id: item._id },
            update: { $set: { 'game.slug': slug !== undefined ? slug : null } }
          }
        });
      }

      if (bulkOps.length > 0) {
        const rawCollection = CollectionItems.rawCollection();
        const result = await rawCollection.bulkWrite(bulkOps, { ordered: false });
        updated += result.modifiedCount || bulkOps.length;
      }

      processed += items.length;
      console.log(`Progress: ${processed} items processed, ${updated} updated`);
    }

    console.log(`✓ Migration complete: ${updated} items updated`);
    console.log('✓ Migration 9 completed successfully');
  },
  down: async function() {
    console.log('Rolling back migration 9 - removing game.slug from collectionItems');

    const rawCollection = CollectionItems.rawCollection();
    const result = await rawCollection.updateMany(
      { 'game.slug': { $exists: true } },
      { $unset: { 'game.slug': '' } }
    );

    console.log(`✓ Removed game.slug from ${result.modifiedCount} collection items`);
    console.log('✓ Migration 9 rollback complete');
  }
});
