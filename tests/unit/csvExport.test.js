import assert from 'assert';
import { escapeCSV, formatDate, escapeRegex } from '../../server/imports/csvExport.js';

describe('CSV Export Helpers', function () {
  describe('escapeCSV', function () {
    it('returns empty string for null', function () {
      assert.strictEqual(escapeCSV(null), '');
    });

    it('returns empty string for undefined', function () {
      assert.strictEqual(escapeCSV(undefined), '');
    });

    it('returns plain text unchanged', function () {
      assert.strictEqual(escapeCSV('hello'), 'hello');
    });

    it('wraps value containing comma in quotes', function () {
      assert.strictEqual(escapeCSV('a,b'), '"a,b"');
    });

    it('wraps value containing newline in quotes', function () {
      assert.strictEqual(escapeCSV('a\nb'), '"a\nb"');
    });

    it('escapes quotes by doubling them', function () {
      assert.strictEqual(escapeCSV('say "hi"'), '"say ""hi"""');
    });

    it('converts numbers to string', function () {
      assert.strictEqual(escapeCSV(42), '42');
    });

    it('handles value with both comma and quote', function () {
      assert.strictEqual(escapeCSV('a,"b"'), '"a,""b"""');
    });
  });

  describe('formatDate', function () {
    it('returns empty string for null', function () {
      assert.strictEqual(formatDate(null), '');
    });

    it('returns empty string for undefined', function () {
      assert.strictEqual(formatDate(undefined), '');
    });

    it('returns empty string for invalid date', function () {
      assert.strictEqual(formatDate('not-a-date'), '');
    });

    it('formats Date object to YYYY-MM-DD', function () {
      const date = new Date('2024-03-15T12:00:00Z');
      assert.strictEqual(formatDate(date), '2024-03-15');
    });

    it('formats date string to YYYY-MM-DD', function () {
      assert.strictEqual(formatDate('2024-01-01T00:00:00Z'), '2024-01-01');
    });
  });

  describe('escapeRegex', function () {
    it('escapes dots', function () {
      assert.strictEqual(escapeRegex('a.b'), 'a\\.b');
    });

    it('escapes asterisks', function () {
      assert.strictEqual(escapeRegex('a*b'), 'a\\*b');
    });

    it('escapes question marks', function () {
      assert.strictEqual(escapeRegex('a?b'), 'a\\?b');
    });

    it('escapes parentheses', function () {
      assert.strictEqual(escapeRegex('(a)'), '\\(a\\)');
    });

    it('escapes brackets', function () {
      assert.strictEqual(escapeRegex('[a]'), '\\[a\\]');
    });

    it('leaves plain text unchanged', function () {
      assert.strictEqual(escapeRegex('hello'), 'hello');
    });

    it('escapes multiple special characters', function () {
      const result = escapeRegex('file.name (v2)');
      assert.strictEqual(result, 'file\\.name \\(v2\\)');
    });
  });
});
