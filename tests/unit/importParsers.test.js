import assert from 'assert';
import { mapStatus, parsePlatforms, parseDate } from '../../server/imports/darkadiaImport.js';
import { validateSteamId, extractSteamUsername, formatPlaytimeHours } from '../../server/imports/steamImport.js';
import { extractGogUsername } from '../../server/imports/gogImport.js';

describe('Import Parser Helpers', function () {
  describe('Darkadia', function () {
    describe('mapStatus', function () {
      it('returns playing when Playing flag is set', function () {
        assert.strictEqual(mapStatus({ Playing: '1' }), 'playing');
      });

      it('returns completed when Finished flag is set', function () {
        assert.strictEqual(mapStatus({ Finished: '1' }), 'completed');
      });

      it('returns completed when Mastered flag is set', function () {
        assert.strictEqual(mapStatus({ Mastered: '1' }), 'completed');
      });

      it('returns completed when Dominated flag is set', function () {
        assert.strictEqual(mapStatus({ Dominated: '1' }), 'completed');
      });

      it('returns abandoned when Shelved flag is set', function () {
        assert.strictEqual(mapStatus({ Shelved: '1' }), 'abandoned');
      });

      it('returns backlog when Owned flag is set', function () {
        assert.strictEqual(mapStatus({ Owned: '1' }), 'backlog');
      });

      it('returns backlog when Played flag is set', function () {
        assert.strictEqual(mapStatus({ Played: '1' }), 'backlog');
      });

      it('returns wishlist when only Loved flag is set', function () {
        assert.strictEqual(mapStatus({ Loved: '1' }), 'wishlist');
      });

      it('defaults to backlog when no flags set', function () {
        assert.strictEqual(mapStatus({}), 'backlog');
      });

      it('prioritizes Playing over Finished', function () {
        assert.strictEqual(mapStatus({ Playing: '1', Finished: '1' }), 'playing');
      });
    });

    describe('parsePlatforms', function () {
      it('returns empty array for null', function () {
        assert.deepStrictEqual(parsePlatforms(null), []);
      });

      it('returns empty array for undefined', function () {
        assert.deepStrictEqual(parsePlatforms(undefined), []);
      });

      it('returns empty array for empty string', function () {
        assert.deepStrictEqual(parsePlatforms(''), []);
      });

      it('parses single platform', function () {
        assert.deepStrictEqual(parsePlatforms('PC'), ['PC']);
      });

      it('parses multiple platforms', function () {
        assert.deepStrictEqual(parsePlatforms('PC, PS5, Switch'), ['PC', 'PS5', 'Switch']);
      });

      it('trims whitespace', function () {
        assert.deepStrictEqual(parsePlatforms(' PC , PS5 '), ['PC', 'PS5']);
      });
    });

    describe('parseDate', function () {
      it('returns null for null', function () {
        assert.strictEqual(parseDate(null), null);
      });

      it('returns null for empty string', function () {
        assert.strictEqual(parseDate(''), null);
      });

      it('returns null for invalid date', function () {
        assert.strictEqual(parseDate('not-a-date'), null);
      });

      it('parses YYYY-MM-DD format', function () {
        const date = parseDate('2024-03-15');
        assert.ok(date instanceof Date);
        assert.ok(!isNaN(date.getTime()));
      });

      it('returns Date object for valid input', function () {
        const date = parseDate('2024-01-01');
        assert.strictEqual(date.getUTCFullYear(), 2024);
      });
    });
  });

  describe('Steam', function () {
    describe('validateSteamId', function () {
      it('returns true for valid 17-digit Steam ID', function () {
        assert.strictEqual(validateSteamId('76561198012345678'), true);
      });

      it('returns false for null', function () {
        assert.strictEqual(validateSteamId(null), false);
      });

      it('returns false for undefined', function () {
        assert.strictEqual(validateSteamId(undefined), false);
      });

      it('returns false for non-string', function () {
        assert.strictEqual(validateSteamId(12345), false);
      });

      it('returns false for too short ID', function () {
        assert.strictEqual(validateSteamId('1234567890'), false);
      });

      it('returns false for too long ID', function () {
        assert.strictEqual(validateSteamId('123456789012345678'), false);
      });

      it('returns false for non-numeric string', function () {
        assert.strictEqual(validateSteamId('abcdefghijklmnopq'), false);
      });

      it('trims whitespace', function () {
        assert.strictEqual(validateSteamId(' 76561198012345678 '), true);
      });
    });

    describe('extractSteamUsername', function () {
      it('extracts username from /id/ URL', function () {
        assert.strictEqual(
          extractSteamUsername('https://steamcommunity.com/id/myuser'),
          'myuser'
        );
      });

      it('extracts Steam ID from /profiles/ URL', function () {
        assert.strictEqual(
          extractSteamUsername('https://steamcommunity.com/profiles/76561198012345678'),
          '76561198012345678'
        );
      });

      it('returns plain username as-is', function () {
        assert.strictEqual(extractSteamUsername('myuser'), 'myuser');
      });

      it('trims whitespace', function () {
        assert.strictEqual(extractSteamUsername('  myuser  '), 'myuser');
      });

      it('throws for null input', function () {
        assert.throws(() => extractSteamUsername(null), /invalid-username/);
      });

      it('throws for undefined input', function () {
        assert.throws(() => extractSteamUsername(undefined), /invalid-username/);
      });

      it('throws for non-string input', function () {
        assert.throws(() => extractSteamUsername(123), /invalid-username/);
      });
    });

    describe('formatPlaytimeHours', function () {
      it('returns null for null', function () {
        assert.strictEqual(formatPlaytimeHours(null), null);
      });

      it('returns null for 0', function () {
        assert.strictEqual(formatPlaytimeHours(0), null);
      });

      it('returns null for undefined', function () {
        assert.strictEqual(formatPlaytimeHours(undefined), null);
      });

      it('converts 60 minutes to 1 hour', function () {
        assert.strictEqual(formatPlaytimeHours(60), 1);
      });

      it('converts 90 minutes to 1.5 hours', function () {
        assert.strictEqual(formatPlaytimeHours(90), 1.5);
      });

      it('rounds to 1 decimal place', function () {
        // 45 minutes = 0.75 hours
        assert.strictEqual(formatPlaytimeHours(45), 0.8);
      });

      it('handles large playtime', function () {
        // 6000 minutes = 100 hours
        assert.strictEqual(formatPlaytimeHours(6000), 100);
      });
    });
  });

  describe('GOG', function () {
    describe('extractGogUsername', function () {
      it('extracts username from GOG profile URL', function () {
        assert.strictEqual(
          extractGogUsername('https://www.gog.com/u/myuser'),
          'myuser'
        );
      });

      it('extracts username from URL with trailing path', function () {
        assert.strictEqual(
          extractGogUsername('https://www.gog.com/u/myuser/games'),
          'myuser'
        );
      });

      it('extracts username from URL without www', function () {
        assert.strictEqual(
          extractGogUsername('https://gog.com/u/myuser'),
          'myuser'
        );
      });

      it('returns plain username as-is', function () {
        assert.strictEqual(extractGogUsername('myuser'), 'myuser');
      });

      it('trims whitespace', function () {
        assert.strictEqual(extractGogUsername('  myuser  '), 'myuser');
      });

      it('throws for null input', function () {
        assert.throws(() => extractGogUsername(null), /invalid-username/);
      });

      it('throws for undefined input', function () {
        assert.throws(() => extractGogUsername(undefined), /invalid-username/);
      });
    });
  });
});
