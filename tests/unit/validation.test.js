import assert from 'assert';
import { validateStatus, validateRating, validateStorefronts } from '../../server/methods.js';

describe('Method Validation Functions', function () {
  describe('validateStatus', function () {
    it('accepts backlog', function () {
      assert.doesNotThrow(() => validateStatus('backlog'));
    });

    it('accepts playing', function () {
      assert.doesNotThrow(() => validateStatus('playing'));
    });

    it('accepts completed', function () {
      assert.doesNotThrow(() => validateStatus('completed'));
    });

    it('accepts abandoned', function () {
      assert.doesNotThrow(() => validateStatus('abandoned'));
    });

    it('accepts wishlist', function () {
      assert.doesNotThrow(() => validateStatus('wishlist'));
    });

    it('throws for invalid status', function () {
      assert.throws(() => validateStatus('invalid'), /invalid-status/);
    });

    it('throws for empty string', function () {
      assert.throws(() => validateStatus(''), /invalid-status/);
    });

    it('throws for null', function () {
      assert.throws(() => validateStatus(null), /invalid-status/);
    });
  });

  describe('validateRating', function () {
    it('accepts null', function () {
      assert.doesNotThrow(() => validateRating(null));
    });

    it('accepts undefined', function () {
      assert.doesNotThrow(() => validateRating(undefined));
    });

    it('accepts rating of 1', function () {
      assert.doesNotThrow(() => validateRating(1));
    });

    it('accepts rating of 5', function () {
      assert.doesNotThrow(() => validateRating(5));
    });

    it('accepts rating of 3', function () {
      assert.doesNotThrow(() => validateRating(3));
    });

    it('throws for rating of 0', function () {
      assert.throws(() => validateRating(0), /invalid-rating/);
    });

    it('throws for rating of 6', function () {
      assert.throws(() => validateRating(6), /invalid-rating/);
    });

    it('throws for non-integer rating', function () {
      assert.throws(() => validateRating(3.5), /invalid-rating/);
    });

    it('throws for negative rating', function () {
      assert.throws(() => validateRating(-1), /invalid-rating/);
    });
  });

  describe('validateStorefronts', function () {
    it('returns empty array for null', function () {
      assert.deepStrictEqual(validateStorefronts(null), []);
    });

    it('returns empty array for empty array', function () {
      assert.deepStrictEqual(validateStorefronts([]), []);
    });

    it('filters out invalid storefront IDs', function () {
      const result = validateStorefronts(['steam', 'nonexistent_store_xyz']);
      assert.ok(result.includes('steam'));
      assert.ok(!result.includes('nonexistent_store_xyz'));
    });

    it('keeps valid storefront IDs', function () {
      const result = validateStorefronts(['steam', 'gog']);
      assert.ok(result.includes('steam'));
      assert.ok(result.includes('gog'));
    });

    it('returns empty array for undefined', function () {
      assert.deepStrictEqual(validateStorefronts(undefined), []);
    });
  });
});
