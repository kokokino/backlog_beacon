import assert from 'assert';
import {
  sanitizeSearchQuery,
  levenshteinDistance,
  normalizeForComparison,
  calculateMatchScore,
  getSearchPatterns,
  getCoverUrl
} from '../../server/igdb/client.js';

describe('IGDB Matching Functions', function () {
  describe('sanitizeSearchQuery', function () {
    it('returns null for null input', function () {
      assert.strictEqual(sanitizeSearchQuery(null), null);
    });

    it('returns undefined for undefined input', function () {
      assert.strictEqual(sanitizeSearchQuery(undefined), undefined);
    });

    it('returns empty string for empty string', function () {
      assert.strictEqual(sanitizeSearchQuery(''), '');
    });

    it('strips registered trademark symbol', function () {
      assert.strictEqual(sanitizeSearchQuery('Game®'), 'Game');
    });

    it('strips trademark symbol', function () {
      assert.strictEqual(sanitizeSearchQuery('Game™'), 'Game');
    });

    it('strips copyright symbol', function () {
      assert.strictEqual(sanitizeSearchQuery('Game©'), 'Game');
    });

    it('strips service mark symbol', function () {
      assert.strictEqual(sanitizeSearchQuery('Game℠'), 'Game');
    });

    it('preserves word boundaries when stripping', function () {
      assert.strictEqual(sanitizeSearchQuery('ACE COMBAT™7'), 'ACE COMBAT 7');
    });

    it('passes through clean input unchanged', function () {
      assert.strictEqual(sanitizeSearchQuery('Half-Life 2'), 'Half-Life 2');
    });

    it('collapses multiple spaces', function () {
      assert.strictEqual(sanitizeSearchQuery('Game™ ® Edition'), 'Game Edition');
    });
  });

  describe('levenshteinDistance', function () {
    it('returns 0 for identical strings', function () {
      assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
    });

    it('returns length of other string when one is empty', function () {
      assert.strictEqual(levenshteinDistance('', 'abc'), 3);
      assert.strictEqual(levenshteinDistance('abc', ''), 3);
    });

    it('returns 0 for two empty strings', function () {
      assert.strictEqual(levenshteinDistance('', ''), 0);
    });

    it('returns 1 for single character difference', function () {
      assert.strictEqual(levenshteinDistance('cat', 'car'), 1);
    });

    it('returns correct distance for insertions', function () {
      assert.strictEqual(levenshteinDistance('abc', 'abcd'), 1);
    });

    it('returns correct distance for completely different strings', function () {
      assert.strictEqual(levenshteinDistance('abc', 'xyz'), 3);
    });

    it('handles case-sensitive comparison', function () {
      assert.strictEqual(levenshteinDistance('ABC', 'abc'), 3);
    });
  });

  describe('normalizeForComparison', function () {
    it('lowercases input', function () {
      assert.strictEqual(normalizeForComparison('HELLO'), 'hello');
    });

    it('replaces ampersand with and', function () {
      const result = normalizeForComparison('Ratchet & Clank');
      assert.ok(result.includes('and'));
      assert.ok(!result.includes('&'));
    });

    it('replaces fractions with words', function () {
      assert.ok(normalizeForComparison('1/2 Life').includes('half'));
    });

    it('removes punctuation', function () {
      const result = normalizeForComparison("Assassin's Creed");
      assert.ok(!result.includes("'"));
    });

    it('collapses spaces between numbers and letters', function () {
      const result = normalizeForComparison('8 Doors');
      assert.ok(result.includes('8doors'));
    });

    it('collapses spaces between letters and numbers', function () {
      const result = normalizeForComparison('Game 2');
      assert.ok(result.includes('game2'));
    });

    it('trims result', function () {
      const result = normalizeForComparison('  hello  ');
      assert.strictEqual(result, 'hello');
    });
  });

  describe('calculateMatchScore', function () {
    it('returns 100 for exact match (case-insensitive)', function () {
      assert.strictEqual(calculateMatchScore('Zelda', 'zelda'), 100);
    });

    it('returns 100 for identical strings', function () {
      assert.strictEqual(calculateMatchScore('Half-Life 2', 'Half-Life 2'), 100);
    });

    it('returns 98 for normalized exact match', function () {
      const score = calculateMatchScore('Ratchet & Clank', 'Ratchet and Clank');
      assert.strictEqual(score, 98);
    });

    it('returns 90 for IGDB name being superset (has subtitle)', function () {
      const score = calculateMatchScore('Half-Life', 'Half-Life: Alyx');
      assert.strictEqual(score, 90);
    });

    it('returns 60 for query having subtitle IGDB lacks', function () {
      const score = calculateMatchScore('Half-Life: Alyx', 'Half-Life');
      assert.strictEqual(score, 60);
    });

    it('returns low score for completely different names', function () {
      const score = calculateMatchScore('Zelda', 'Call of Duty');
      assert.ok(score < 50);
    });

    it('returns at least 75 when one contains the other', function () {
      const score = calculateMatchScore('Super Mario', 'Super Mario Bros');
      assert.ok(score >= 75);
    });
  });

  describe('getSearchPatterns', function () {
    it('returns at least one pattern for any name', function () {
      const patterns = getSearchPatterns('Zelda');
      assert.ok(patterns.length >= 1);
      assert.strictEqual(patterns[0].type, 'search');
    });

    it('generates pattern before colon for names with colon', function () {
      const patterns = getSearchPatterns('Cat Quest II: The Lupus Empire');
      const values = patterns.map(p => p.value);
      assert.ok(values.includes('Cat Quest II'));
    });

    it('generates pattern before dash for names with dash', function () {
      const patterns = getSearchPatterns('Hundred Days - Winemaking Simulator');
      const values = patterns.map(p => p.value);
      assert.ok(values.includes('Hundred Days'));
    });

    it('generates slash replacement pattern', function () {
      const patterns = getSearchPatterns('Zombies/Ghoul');
      const values = patterns.map(p => p.value);
      assert.ok(values.some(v => v.includes('and')));
    });

    it('generates collapsed number-letter pattern', function () {
      const patterns = getSearchPatterns('8 Doors of Mystery');
      const values = patterns.map(p => p.value);
      assert.ok(values.some(v => v.includes('8Doors')));
    });

    it('does not include duplicate patterns', function () {
      const patterns = getSearchPatterns('Simple Game');
      const values = patterns.map(p => p.value);
      const uniqueValues = [...new Set(values)];
      assert.strictEqual(values.length, uniqueValues.length);
    });
  });

  describe('getCoverUrl', function () {
    it('returns null for null imageId', function () {
      assert.strictEqual(getCoverUrl(null), null);
    });

    it('returns null for undefined imageId', function () {
      assert.strictEqual(getCoverUrl(undefined), null);
    });

    it('builds correct URL with default size', function () {
      const url = getCoverUrl('abc123');
      assert.strictEqual(url, 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg');
    });

    it('builds correct URL with custom size', function () {
      const url = getCoverUrl('abc123', '720p');
      assert.strictEqual(url, 'https://images.igdb.com/igdb/image/upload/t_720p/abc123.jpg');
    });
  });
});
