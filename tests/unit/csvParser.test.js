import assert from 'assert';
import { parseCSV, parseCSVToObjects } from '../../server/imports/csvParser.js';

describe('CSV Parser', function () {
  describe('parseCSV', function () {
    it('returns empty array for empty input', function () {
      const result = parseCSV('');
      assert.deepStrictEqual(result, []);
    });

    it('parses single row', function () {
      const result = parseCSV('a,b,c');
      assert.deepStrictEqual(result, [['a', 'b', 'c']]);
    });

    it('parses multiple rows', function () {
      const result = parseCSV('a,b\nc,d');
      assert.deepStrictEqual(result, [['a', 'b'], ['c', 'd']]);
    });

    it('handles quoted fields', function () {
      const result = parseCSV('"hello","world"');
      assert.deepStrictEqual(result, [['hello', 'world']]);
    });

    it('handles escaped quotes inside quoted fields', function () {
      const result = parseCSV('"say ""hello""",b');
      assert.deepStrictEqual(result, [['say "hello"', 'b']]);
    });

    it('handles multiline values inside quotes', function () {
      const result = parseCSV('"line1\nline2",b');
      assert.deepStrictEqual(result, [['line1\nline2', 'b']]);
    });

    it('handles Windows line endings (CRLF)', function () {
      const result = parseCSV('a,b\r\nc,d');
      assert.deepStrictEqual(result, [['a', 'b'], ['c', 'd']]);
    });

    it('handles commas inside quoted fields', function () {
      const result = parseCSV('"a,b",c');
      assert.deepStrictEqual(result, [['a,b', 'c']]);
    });

    it('skips empty rows', function () {
      const result = parseCSV('a,b\n\nc,d');
      assert.deepStrictEqual(result, [['a', 'b'], ['c', 'd']]);
    });

    it('trims field whitespace', function () {
      const result = parseCSV(' a , b ');
      assert.deepStrictEqual(result, [['a', 'b']]);
    });
  });

  describe('parseCSVToObjects', function () {
    it('returns empty array for empty input', function () {
      const result = parseCSVToObjects('');
      assert.deepStrictEqual(result, []);
    });

    it('returns empty array for header-only input', function () {
      const result = parseCSVToObjects('Name,Status');
      assert.deepStrictEqual(result, []);
    });

    it('maps headers to object keys', function () {
      const result = parseCSVToObjects('Name,Status\nZelda,playing');
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].Name, 'Zelda');
      assert.strictEqual(result[0].Status, 'playing');
    });

    it('uses empty string for missing fields', function () {
      const result = parseCSVToObjects('Name,Status,Rating\nZelda,playing');
      assert.strictEqual(result[0].Rating, '');
    });

    it('handles multiple data rows', function () {
      const result = parseCSVToObjects('Name\nGame1\nGame2\nGame3');
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].Name, 'Game1');
      assert.strictEqual(result[2].Name, 'Game3');
    });
  });
});
