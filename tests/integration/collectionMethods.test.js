import assert from 'assert';
import { createTestUser, callAsUser, removeTestUser } from '../helpers/testUser.js';
import { createTestGame, createTestCollectionItem, cleanupUser } from '../helpers/testData.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { Games } from '../../imports/lib/collections/games.js';

describe('Collection Methods (Integration)', function () {
  let userId;
  let game;

  beforeEach(async function () {
    userId = await createTestUser();
    game = await createTestGame();
  });

  afterEach(async function () {
    await cleanupUser(userId);
    await Games.removeAsync(game._id);
    await removeTestUser(userId);
  });

  describe('collection.addItem', function () {
    it('adds item to collection', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      assert.ok(itemId);

      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.userId, userId);
      assert.strictEqual(item.gameId, game._id);
      assert.strictEqual(item.status, 'backlog');
      assert.deepStrictEqual(item.platforms, ['PC']);
    });

    it('rejects duplicate game in collection', async function () {
      await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');

      try {
        await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
        assert.fail('Should have thrown duplicate error');
      } catch (error) {
        assert.strictEqual(error.error, 'duplicate-item');
      }
    });

    it('rejects invalid status', async function () {
      try {
        await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'invalid_status');
        assert.fail('Should have thrown invalid status error');
      } catch (error) {
        assert.strictEqual(error.error, 'invalid-status');
      }
    });

    it('rejects nonexistent game', async function () {
      try {
        await callAsUser(userId, 'collection.addItem', 'nonexistent_id', 'PC', 'backlog');
        assert.fail('Should have thrown game not found error');
      } catch (error) {
        assert.strictEqual(error.error, 'game-not-found');
      }
    });

    it('accepts storefronts option', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog', {
        storefronts: ['steam', 'gog']
      });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.ok(item.storefronts.includes('steam'));
      assert.ok(item.storefronts.includes('gog'));
    });

    it('sets dateAdded on creation', async function () {
      const before = new Date();
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      const item = await CollectionItems.findOneAsync(itemId);
      assert.ok(item.dateAdded >= before);
    });
  });

  describe('collection.updateItem', function () {
    let itemId;

    beforeEach(async function () {
      itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
    });

    it('updates status', async function () {
      await callAsUser(userId, 'collection.updateItem', itemId, { status: 'playing' });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.status, 'playing');
    });

    it('updates rating', async function () {
      await callAsUser(userId, 'collection.updateItem', itemId, { rating: 4 });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.rating, 4);
    });

    it('rejects invalid rating', async function () {
      try {
        await callAsUser(userId, 'collection.updateItem', itemId, { rating: 6 });
        assert.fail('Should have thrown invalid rating error');
      } catch (error) {
        assert.strictEqual(error.error, 'invalid-rating');
      }
    });

    it('auto-sets dateCompleted when status changes to completed', async function () {
      await callAsUser(userId, 'collection.updateItem', itemId, { status: 'completed' });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.ok(item.dateCompleted instanceof Date);
    });

    it('does not overwrite existing dateCompleted', async function () {
      const manualDate = new Date('2024-01-01');
      await callAsUser(userId, 'collection.updateItem', itemId, { dateCompleted: manualDate });
      await callAsUser(userId, 'collection.updateItem', itemId, { status: 'completed' });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.dateCompleted.getTime(), manualDate.getTime());
    });

    it('rejects update from other user', async function () {
      const otherUserId = await createTestUser();
      try {
        await callAsUser(otherUserId, 'collection.updateItem', itemId, { status: 'playing' });
        assert.fail('Should have thrown not-authorized error');
      } catch (error) {
        assert.strictEqual(error.error, 'not-authorized');
      } finally {
        await removeTestUser(otherUserId);
      }
    });

    it('updates notes', async function () {
      await callAsUser(userId, 'collection.updateItem', itemId, { notes: 'Great game' });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.notes, 'Great game');
    });

    it('updates hoursPlayed', async function () {
      await callAsUser(userId, 'collection.updateItem', itemId, { hoursPlayed: 25.5 });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.hoursPlayed, 25.5);
    });

    it('rejects negative hoursPlayed', async function () {
      try {
        await callAsUser(userId, 'collection.updateItem', itemId, { hoursPlayed: -5 });
        assert.fail('Should have thrown invalid hours error');
      } catch (error) {
        assert.strictEqual(error.error, 'invalid-hours');
      }
    });

    it('sets updatedAt on update', async function () {
      const before = new Date();
      await callAsUser(userId, 'collection.updateItem', itemId, { status: 'playing' });
      const item = await CollectionItems.findOneAsync(itemId);
      assert.ok(item.updatedAt >= before);
    });
  });

  describe('collection.removeItem', function () {
    it('removes item from collection', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.removeItem', itemId);
      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item, undefined);
    });

    it('rejects removal of nonexistent item', async function () {
      try {
        await callAsUser(userId, 'collection.removeItem', 'nonexistent_id');
        assert.fail('Should have thrown item not found error');
      } catch (error) {
        assert.strictEqual(error.error, 'item-not-found');
      }
    });

    it('rejects removal from other user', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      const otherUserId = await createTestUser();
      try {
        await callAsUser(otherUserId, 'collection.removeItem', itemId);
        assert.fail('Should have thrown not-authorized error');
      } catch (error) {
        assert.strictEqual(error.error, 'not-authorized');
      } finally {
        await removeTestUser(otherUserId);
      }
    });

    it('cascade deletes custom game when removing last collection item', async function () {
      const customGame = await createTestGame({ ownerId: userId });
      const itemId = await callAsUser(userId, 'collection.addItem', customGame._id, 'PC', 'backlog');

      await callAsUser(userId, 'collection.removeItem', itemId);

      const deletedGame = await Games.findOneAsync(customGame._id);
      assert.strictEqual(deletedGame, undefined);
    });
  });

  describe('collection.toggleFavorite', function () {
    it('toggles favorite on', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      const result = await callAsUser(userId, 'collection.toggleFavorite', itemId);
      assert.strictEqual(result, true);

      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.favorite, true);
    });

    it('toggles favorite off', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.toggleFavorite', itemId);
      const result = await callAsUser(userId, 'collection.toggleFavorite', itemId);
      assert.strictEqual(result, false);

      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.favorite, false);
    });
  });

  describe('collection.setStatus', function () {
    it('sets status', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.setStatus', itemId, 'playing');

      const item = await CollectionItems.findOneAsync(itemId);
      assert.strictEqual(item.status, 'playing');
    });

    it('auto-sets dateCompleted when setting to completed', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.setStatus', itemId, 'completed');

      const item = await CollectionItems.findOneAsync(itemId);
      assert.ok(item.dateCompleted instanceof Date);
    });

    it('rejects invalid status', async function () {
      const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      try {
        await callAsUser(userId, 'collection.setStatus', itemId, 'invalid');
        assert.fail('Should have thrown invalid status error');
      } catch (error) {
        assert.strictEqual(error.error, 'invalid-status');
      }
    });
  });

  describe('collection.getStats', function () {
    it('returns empty stats for user with no items', async function () {
      const stats = await callAsUser(userId, 'collection.getStats');
      assert.strictEqual(stats.total, 0);
      assert.strictEqual(stats.byStatus.backlog, 0);
      assert.strictEqual(stats.favorites, 0);
    });

    it('returns correct stats for populated collection', async function () {
      const game2 = await createTestGame();
      const game3 = await createTestGame();

      await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.addItem', game2._id, 'PS5', 'playing');
      const item3Id = await callAsUser(userId, 'collection.addItem', game3._id, 'PC', 'completed');
      await callAsUser(userId, 'collection.updateItem', item3Id, { rating: 4, hoursPlayed: 20 });

      const stats = await callAsUser(userId, 'collection.getStats');

      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.byStatus.backlog, 1);
      assert.strictEqual(stats.byStatus.playing, 1);
      assert.strictEqual(stats.byStatus.completed, 1);
      assert.ok(stats.platformCounts['PC'] >= 2);
      assert.strictEqual(stats.totalHoursPlayed, 20);

      // Cleanup extra games
      await Games.removeAsync(game2._id);
      await Games.removeAsync(game3._id);
    });
  });

  describe('collection.getCount', function () {
    it('returns 0 for empty collection', async function () {
      const count = await callAsUser(userId, 'collection.getCount');
      assert.strictEqual(count, 0);
    });

    it('returns total count', async function () {
      const game2 = await createTestGame();
      await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.addItem', game2._id, 'PC', 'playing');

      const count = await callAsUser(userId, 'collection.getCount');
      assert.strictEqual(count, 2);

      await Games.removeAsync(game2._id);
    });

    it('filters by status', async function () {
      const game2 = await createTestGame();
      await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.addItem', game2._id, 'PC', 'playing');

      const count = await callAsUser(userId, 'collection.getCount', { status: 'backlog' });
      assert.strictEqual(count, 1);

      await Games.removeAsync(game2._id);
    });

    it('filters by platform', async function () {
      const game2 = await createTestGame();
      await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
      await callAsUser(userId, 'collection.addItem', game2._id, 'PS5', 'backlog');

      const count = await callAsUser(userId, 'collection.getCount', { platform: 'PC' });
      assert.strictEqual(count, 1);

      await Games.removeAsync(game2._id);
    });
  });

  describe('collection.getGameIds', function () {
    it('returns empty array for user with no items', async function () {
      const ids = await callAsUser(userId, 'collection.getGameIds');
      assert.deepStrictEqual(ids, []);
    });

    it('returns game IDs for user items', async function () {
      await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');

      const ids = await callAsUser(userId, 'collection.getGameIds');
      assert.strictEqual(ids.length, 1);
      assert.strictEqual(ids[0], game._id);
    });
  });
});
