import assert from 'assert';
import { buildEmbeddedGame } from '../../server/lib/gameHelpers.js';

describe('Game Helpers', function () {
  describe('buildEmbeddedGame', function () {
    it('returns null for null input', function () {
      assert.strictEqual(buildEmbeddedGame(null), null);
    });

    it('returns null for undefined input', function () {
      assert.strictEqual(buildEmbeddedGame(undefined), null);
    });

    it('returns embedded game with all fields from full game', function () {
      const game = {
        _id: 'game123',
        title: 'Zelda',
        slug: 'zelda-tears-of-the-kingdom',
        releaseYear: 2023,
        ownerId: 'user1',
        genres: ['Action', 'Adventure'],
        localCoverUrl: '/covers/zelda.webp',
        coverImageId: 'co1234',
        igdbCoverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg',
        igdbId: 99999,
        summary: 'An adventure game'
      };

      const result = buildEmbeddedGame(game);

      assert.strictEqual(result.title, 'Zelda');
      assert.strictEqual(result.slug, 'zelda-tears-of-the-kingdom');
      assert.strictEqual(result.releaseYear, 2023);
      assert.strictEqual(result.ownerId, 'user1');
      assert.deepStrictEqual(result.genres, ['Action', 'Adventure']);
      assert.strictEqual(result.localCoverUrl, '/covers/zelda.webp');
      assert.strictEqual(result.coverImageId, 'co1234');
      assert.strictEqual(result.igdbCoverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg');
    });

    it('does not include extra fields like igdbId or summary', function () {
      const game = {
        title: 'Test',
        igdbId: 123,
        summary: 'A test'
      };

      const result = buildEmbeddedGame(game);

      assert.strictEqual(result.igdbId, undefined);
      assert.strictEqual(result.summary, undefined);
    });

    it('handles minimal game with only title', function () {
      const game = { title: 'Minimal' };
      const result = buildEmbeddedGame(game);

      assert.strictEqual(result.title, 'Minimal');
      assert.strictEqual(result.slug, null);
      assert.strictEqual(result.releaseYear, null);
      assert.strictEqual(result.ownerId, null);
      assert.deepStrictEqual(result.genres, []);
      assert.strictEqual(result.localCoverUrl, null);
      assert.strictEqual(result.coverImageId, null);
      assert.strictEqual(result.igdbCoverUrl, null);
    });

    it('handles empty object', function () {
      const result = buildEmbeddedGame({});

      assert.strictEqual(result.title, null);
      assert.strictEqual(result.slug, null);
      assert.strictEqual(result.releaseYear, null);
      assert.deepStrictEqual(result.genres, []);
    });
  });
});
