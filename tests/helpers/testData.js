import { Random } from 'meteor/random';
import { Games } from '../../imports/lib/collections/games.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { buildEmbeddedGame } from '../../server/lib/gameHelpers.js';

/**
 * Create a test game in the database
 * @param {Object} overrides - Fields to override defaults
 * @returns {Object} { _id, ...game }
 */
export async function createTestGame(overrides = {}) {
  const defaults = {
    igdbId: Math.floor(Math.random() * 100000) + 1,
    title: `Test Game ${Random.id(6)}`,
    slug: `test-game-${Random.id(6)}`,
    platforms: ['PC'],
    genres: ['Action'],
    developer: 'Test Studio',
    publisher: 'Test Publisher',
    releaseYear: 2024,
    coverImageId: `co${Random.id(4)}`,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const game = { ...defaults, ...overrides };
  const gameId = await Games.insertAsync(game);
  return { _id: gameId, ...game };
}

/**
 * Create a test collection item in the database
 * @param {string} userId
 * @param {string} gameId
 * @param {Object} overrides - Fields to override defaults
 * @returns {string} itemId
 */
export async function createTestCollectionItem(userId, gameId, overrides = {}) {
  const game = gameId ? await Games.findOneAsync(gameId) : null;

  const defaults = {
    userId,
    gameId: gameId || null,
    igdbId: game?.igdbId || null,
    game: game ? buildEmbeddedGame(game) : null,
    platforms: ['PC'],
    storefronts: ['steam'],
    status: 'backlog',
    rating: null,
    hoursPlayed: null,
    notes: '',
    dateAdded: new Date(),
    dateStarted: null,
    dateCompleted: null,
    favorite: false,
    physical: false,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const item = { ...defaults, ...overrides };
  return CollectionItems.insertAsync(item);
}

/**
 * Clean up all test data for a user
 * @param {string} userId
 */
export async function cleanupUser(userId) {
  await CollectionItems.removeAsync({ userId });
  await Games.removeAsync({ ownerId: userId });
}
