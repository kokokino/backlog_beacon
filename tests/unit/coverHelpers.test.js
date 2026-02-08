import assert from 'assert';
import { getCoverSources, getCoverUrl, getPreloadUrls, noCoverSvg } from '../../imports/ui/lib/coverUrls.js';
import { hasLocalCover, needsCoverProcessing } from '../../server/covers/coverHelpers.js';

describe('Cover Helpers', function () {
  describe('hasLocalCover', function () {
    it('returns false for null game', function () {
      assert.strictEqual(hasLocalCover(null), false);
    });

    it('returns false for game with no cover fields', function () {
      assert.strictEqual(hasLocalCover({}), false);
    });

    it('returns true for game with localCoverUrl', function () {
      assert.strictEqual(hasLocalCover({ localCoverUrl: '/covers/test.webp' }), true);
    });

    it('returns true for game with localCoverId', function () {
      assert.strictEqual(hasLocalCover({ localCoverId: 'cover123' }), true);
    });

    it('returns true when both are present', function () {
      assert.strictEqual(hasLocalCover({ localCoverUrl: '/covers/test.webp', localCoverId: 'cover123' }), true);
    });
  });

  describe('needsCoverProcessing', function () {
    it('returns false for null game', function () {
      assert.strictEqual(needsCoverProcessing(null), false);
    });

    it('returns false for game with no cover fields', function () {
      assert.strictEqual(needsCoverProcessing({}), false);
    });

    it('returns true for game with coverImageId but no local cover', function () {
      assert.strictEqual(needsCoverProcessing({ coverImageId: 'co1234' }), true);
    });

    it('returns false for game with coverImageId and localCoverUrl', function () {
      assert.strictEqual(needsCoverProcessing({ coverImageId: 'co1234', localCoverUrl: '/covers/test.webp' }), false);
    });

    it('returns false for game with coverImageId and localCoverId', function () {
      assert.strictEqual(needsCoverProcessing({ coverImageId: 'co1234', localCoverId: 'id123' }), false);
    });

    it('returns false for game without coverImageId', function () {
      assert.strictEqual(needsCoverProcessing({ title: 'Test' }), false);
    });
  });

  describe('getCoverSources', function () {
    it('returns nulls for null game', function () {
      const result = getCoverSources(null);
      assert.strictEqual(result.localCoverUrl, null);
      assert.strictEqual(result.igdbCoverUrl, null);
    });

    it('returns localCoverUrl when available', function () {
      const result = getCoverSources({ localCoverUrl: '/covers/test.webp' });
      assert.strictEqual(result.localCoverUrl, '/covers/test.webp');
    });

    it('builds igdbCoverUrl from coverImageId', function () {
      const result = getCoverSources({ coverImageId: 'co1234' });
      assert.strictEqual(result.igdbCoverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg');
    });

    it('uses igdbCoverUrl field when coverImageId is missing', function () {
      const result = getCoverSources({ igdbCoverUrl: 'https://example.com/cover.jpg' });
      assert.strictEqual(result.igdbCoverUrl, 'https://example.com/cover.jpg');
    });

    it('prefers coverImageId over igdbCoverUrl', function () {
      const result = getCoverSources({
        coverImageId: 'co1234',
        igdbCoverUrl: 'https://example.com/old.jpg'
      });
      assert.strictEqual(result.igdbCoverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg');
    });
  });

  describe('getCoverUrl', function () {
    it('returns localCoverUrl when available', function () {
      assert.strictEqual(getCoverUrl({ localCoverUrl: '/covers/test.webp' }), '/covers/test.webp');
    });

    it('returns IGDB URL when no local cover', function () {
      const url = getCoverUrl({ coverImageId: 'co1234' });
      assert.ok(url.includes('co1234'));
    });

    it('returns placeholder SVG when no cover at all', function () {
      assert.strictEqual(getCoverUrl({}), noCoverSvg);
    });

    it('returns placeholder for null game', function () {
      assert.strictEqual(getCoverUrl(null), noCoverSvg);
    });
  });

  describe('getPreloadUrls', function () {
    it('returns empty array for null game', function () {
      assert.deepStrictEqual(getPreloadUrls(null), []);
    });

    it('returns empty array for game with no covers', function () {
      assert.deepStrictEqual(getPreloadUrls({}), []);
    });

    it('includes localCoverUrl when available', function () {
      const urls = getPreloadUrls({ localCoverUrl: '/covers/test.webp' });
      assert.ok(urls.includes('/covers/test.webp'));
    });

    it('includes IGDB URL when available', function () {
      const urls = getPreloadUrls({ coverImageId: 'co1234' });
      assert.ok(urls.some(u => u.includes('co1234')));
    });

    it('includes both local and IGDB when both available', function () {
      const urls = getPreloadUrls({ localCoverUrl: '/covers/test.webp', coverImageId: 'co1234' });
      assert.strictEqual(urls.length, 2);
    });
  });
});
