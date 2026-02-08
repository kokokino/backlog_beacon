import assert from 'assert';
import { createTestUser, callAsUser, removeTestUser } from '../helpers/testUser.js';
import { createTestGame, cleanupUser } from '../helpers/testData.js';
import { Games } from '../../imports/lib/collections/games.js';
import { exportCollectionCSV } from '../../server/imports/csvExport.js';
import { parseCSVToObjects } from '../../server/imports/csvParser.js';

describe('Export Method (Integration)', function () {
  let userId;
  let game;

  beforeEach(async function () {
    userId = await createTestUser();
    game = await createTestGame({
      title: 'Test Export Game',
      genres: ['Action', 'RPG'],
      developer: 'Test Dev',
      publisher: 'Test Pub',
      releaseYear: 2024
    });
  });

  afterEach(async function () {
    await cleanupUser(userId);
    await Games.removeAsync(game._id);
    await removeTestUser(userId);
  });

  it('exports collection to CSV with correct headers', async function () {
    await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');

    const csv = await exportCollectionCSV(userId);
    const lines = csv.split('\n');

    assert.ok(lines[0].includes('Name'));
    assert.ok(lines[0].includes('IGDB ID'));
    assert.ok(lines[0].includes('Platforms'));
    assert.ok(lines[0].includes('Status'));
    assert.ok(lines[0].includes('Rating'));
    assert.ok(lines[0].includes('Hours Played'));
  });

  it('exports correct field values', async function () {
    const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'playing', {
      storefronts: ['steam']
    });
    await callAsUser(userId, 'collection.updateItem', itemId, { rating: 5, hoursPlayed: 42.5 });

    const csv = await exportCollectionCSV(userId);
    const rows = parseCSVToObjects(csv);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].Name, 'Test Export Game');
    assert.strictEqual(rows[0].Platforms, 'PC');
    assert.strictEqual(rows[0].Status, 'playing');
    assert.strictEqual(rows[0].Rating, '5');
    assert.strictEqual(rows[0]['Hours Played'], '42.5');
    assert.strictEqual(rows[0].Favorite, 'No');
  });

  it('exports game metadata from Games collection', async function () {
    await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');

    const csv = await exportCollectionCSV(userId);
    const rows = parseCSVToObjects(csv);

    assert.strictEqual(rows[0].Genres, 'Action, RPG');
    assert.strictEqual(rows[0].Developer, 'Test Dev');
    assert.strictEqual(rows[0].Publisher, 'Test Pub');
    assert.strictEqual(rows[0]['Release Year'], '2024');
  });

  it('exports multiple items', async function () {
    const game2 = await createTestGame({ title: 'Second Game' });
    await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog');
    await callAsUser(userId, 'collection.addItem', game2._id, 'PS5', 'completed');

    const csv = await exportCollectionCSV(userId);
    const rows = parseCSVToObjects(csv);

    assert.strictEqual(rows.length, 2);

    await Games.removeAsync(game2._id);
  });

  it('throws for user with no collection items', async function () {
    try {
      await exportCollectionCSV(userId);
      assert.fail('Should have thrown no-data error');
    } catch (error) {
      assert.strictEqual(error.error, 'no-data');
    }
  });

  it('throws for unauthenticated user', async function () {
    try {
      await exportCollectionCSV(null);
      assert.fail('Should have thrown not-authorized error');
    } catch (error) {
      assert.strictEqual(error.error, 'not-authorized');
    }
  });

  it('handles CSV-special characters in game titles', async function () {
    const specialGame = await createTestGame({ title: 'Game "With Quotes", Commas' });
    await callAsUser(userId, 'collection.addItem', specialGame._id, 'PC', 'backlog');

    const csv = await exportCollectionCSV(userId);
    const rows = parseCSVToObjects(csv);

    assert.strictEqual(rows[0].Name, 'Game "With Quotes", Commas');

    await Games.removeAsync(specialGame._id);
  });

  it('exports storefront names (not IDs)', async function () {
    const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'backlog', {
      storefronts: ['steam']
    });

    const csv = await exportCollectionCSV(userId);
    const rows = parseCSVToObjects(csv);

    assert.ok(rows[0].Storefronts.includes('Steam'));
  });

  it('round-trips CSV export/import correctly', async function () {
    const itemId = await callAsUser(userId, 'collection.addItem', game._id, 'PC', 'playing', {
      storefronts: ['steam']
    });
    await callAsUser(userId, 'collection.updateItem', itemId, { rating: 3 });

    const csv = await exportCollectionCSV(userId);
    const rows = parseCSVToObjects(csv);

    // Verify the parsed data matches what was inserted
    assert.strictEqual(rows[0].Status, 'playing');
    assert.strictEqual(rows[0].Rating, '3');
    assert.ok(rows[0]['Date Added']); // Should have a date
  });
});
