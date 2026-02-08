# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backlog Beacon is a video game collection management app built with Meteor 3.x. It's a "spoke" app in the Kokokino ecosystem, relying on the central Hub (kokokino.com) for authentication and billing via SSO.

## Commands

```bash
npm run dev                  # Run dev server on port 3020 with settings
npm test                     # Run tests once with Mocha
npm run test-app             # Run tests in watch mode with full app
npm run visualize            # Production build with bundle analyzer

# Run specific test by describe/it name
TEST_GREP="SSO Token" npm test
```

Note: The Hub must be running (usually on port 3000) for SSO authentication to work.

## Tech Stack

- **Meteor 3.x** - Full-stack framework (async/await, no fibers)
- **Mithril.js 2.3** - UI framework (not React)
- **Pico CSS** - Minimal styling framework
- **MongoDB** - Database
- **sharp** - Image processing (JPEG to WebP for covers)
- **ostrio:files** - File serving from disk
- **quave:migrations** - Database migrations
- **Babylon.js 8** - 3D beanstalk visualization

## Architecture

### Hub & Spoke SSO Flow
1. User logs into Hub at kokokino.com
2. Clicks "Launch Backlog Beacon" → Hub generates RS256 JWT with nonce
3. Browser redirects to `/sso?token=<JWT>`
4. App validates signature with Hub's public key, checks nonce for replay
5. User created/updated locally, session established

Nonce replay protection uses MongoDB TTL index on `UsedNonces` collection (auto-expires after 10 minutes).

### Key Directories
- `imports/hub/` - SSO validation, Hub API client, subscription checks
- `imports/ui/` - Mithril components (pages/, components/, layouts/)
- `imports/ui/components/beanstalk/` - 3D scene (Babylon.js)
- `imports/ui/lib/` - Shared utilities (coverUrls, imagePreloader, toast)
- `imports/lib/collections/` - MongoDB collections with schema docs and exported constants
- `server/covers/` - Background cover image processing queue
- `server/imports/` - Import source parsers (Steam, GOG, PSN, etc.)
- `server/igdb/` - IGDB API client with OAuth2 + distributed rate limiting (4 req/sec)
- `server/migrations/` - Sequential migrations (numbered `1_`, `2_`, etc.)
- `server/lib/` - Utilities like distributed rate limiting
- `cdn/` - Generated cover images (gitignored)

### Routing
Routes are defined in `client/main.js` using Mithril's `m.route()`. A `layoutRoute()` helper wraps pages in `MainLayout` with a `MeteorWrapper` that uses `Tracker.autorun()` to trigger `m.redraw()` on Meteor user state changes. The `/sso` route is the only one not wrapped in the layout.

### Data Flow
- **Publications** stream reactive data via `Meteor.subscribe()` — all check auth first and use explicit field projections
- **Methods** handle mutations via `Meteor.callAsync()`
- **Tracker.autorun()** triggers Mithril redraws on data changes

### Data Denormalization
CollectionItems embed frequently-accessed game fields to avoid `$lookup` joins. The `buildEmbeddedGame(game)` helper in `server/lib/gameHelpers.js` extracts `title`, `releaseYear`, `ownerId`, `genres`, `localCoverUrl`, `coverImageId`, and `igdbCoverUrl`. When adding new game fields that need to appear in collection views, update this function and consider a backfill migration.

## Coding Conventions

### JavaScript
- Always use async/await (Meteor 3 pattern, no fibers)
- Use `const` by default, `let` when needed, avoid `var`
- Always use curly braces with `if` blocks
- Prefer single return statement at end of functions
- Use full variable names (`document` not `doc`, `count` not `i`)
- Each variable declaration on its own line

### UI
- Use Mithril.js, not React
- Leverage Pico CSS patterns, avoid inline styles
- Use semantic CSS class names (`warning` not `yellow`)

### Security
- All mutations validate user ownership
- Rate limiting on method calls (10 req/sec/user)
- Never use `autopublish` or `insecure` packages
- SSO nonces prevent replay attacks

## Key Patterns

### Mithril Components
```javascript
const MyComponent = {
  oninit(vnode) { /* setup */ },
  oncreate(vnode) { /* DOM ready */ },
  onremove(vnode) { /* cleanup */ },
  view(vnode) { return m('div', 'content'); }
};
```

### Meteor Subscriptions with Tracker
```javascript
oninit() {
  Tracker.autorun(() => {
    this.ready = Meteor.subscribe('myData').ready();
    m.redraw();
  });
}
```

### Protected Routes
- `RequireAuth` HOC - redirects to `/not-logged-in` if unauthenticated
- `RequireSubscription` HOC - checks product access via Hub, redirects to `/no-subscription`
- Usage: `m(RequireAuth, m(RequireSubscription, m(PageComponent)))`

### Meteor Methods
All methods follow this pattern (see `server/methods.js`):
```javascript
async 'collection.addItem'(gameId, platform, status = 'backlog') {
  check(gameId, String);
  check(platform, String);

  if (!this.userId) {
    throw new Meteor.Error('not-authorized', 'You must be logged in');
  }

  await checkRateLimit(this.userId, 'collection.addItem');

  // Business logic...
  return itemId;
}
```

### Publications
Same auth-check pattern as methods, but use `this.ready(); return;` for unauthenticated users (not `throw`), and always use explicit field projections in `find()`.

### MongoDB Aggregations
Complex queries use `$facet` for single-pass computation (see `collection.getStats`):
```javascript
const pipeline = [
  { $match: { userId: this.userId } },
  { $facet: {
    statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
    platformCounts: [{ $unwind: '$platforms' }, { $group: { _id: '$platforms', count: { $sum: 1 } } }],
    totals: [{ $group: { _id: null, total: { $sum: 1 }, hours: { $sum: '$hoursPlayed' } } }]
  }}
];
```

## Game Import System

Two-phase import flow in `server/methods/importMethods.js`:
1. **Preview**: User provides credentials/CSV → server fetches external data, matches against IGDB via `searchAndCacheGame()` → returns matched/unmatched games
2. **Confirm**: User selects which games to import → server creates CollectionItems with `buildEmbeddedGame()`

Supported sources: Steam, GOG, Epic, Amazon, Oculus, EA, Ubisoft, Xbox, PlayStation, Battle.net, Legacy Games, RetroAchievements, plus CSV (Darkadia, Backlog Beacon exports).

Import progress is tracked in the `ImportProgress` collection and published reactively. Cooldown rate limit: 1 minute between imports per user.

## Rate Limiting

Distributed rate limiting via MongoDB atomic operations (`server/lib/distributedRateLimit.js`):
- **Window-based**: `checkDistributedRateLimit(key, maxRequests, windowMs)` - 10 req/sec/user for methods
- **Cooldown-based**: `checkCooldownRateLimit(key, cooldownMs)` - one request per interval
- **Blocking wait**: `waitForRateLimit(key, maxRequests, windowMs)` - used for IGDB (4 req/sec)
- Works across multiple server instances without distributed locks

## Cover Processing Pipeline

Background queue system in `server/covers/`:
- `CoverQueue` collection tracks pending/processing/completed items
- Atomic claiming with `findOneAndUpdate` ensures single instance processes each item
- Streaming: IGDB → sharp (WebP conversion) → B2/local storage (no RAM buffering)
- Priority system: user-accessed games processed before bulk imports
- Max 3 retries before marking failed

Client-side cover URL fallback chain (`imports/ui/lib/coverUrls.js`):
1. `localCoverUrl` — processed WebP from local/B2 storage
2. `igdbCoverUrl` — IGDB CDN (built from `coverImageId`)
3. SVG placeholder (data URI)

## 3D Beanstalk Scene (Babylon.js)

Files in `imports/ui/components/beanstalk/`:
- **BeanstalkScene.js** — Main orchestrator: engine, camera, lighting, sky
- **BeanstalkPool.js** — `ObjectPool` (reusable meshes) and `TextureCache` (LRU with async loading, max 200)
- **GameCase3D.js** — DVD case mesh with cover texture, `releaseTexture()` for pool return
- **BeanstalkPlant.js** — Central stem mesh
- **BeanstalkInput.js** — Camera controls (pan, zoom, rotate)
- **BeanstalkEffects.js** — Visual effects (fog, lighting)
- **LeafData.js** — Leaf mesh generation

**TextureCache** is an LRU cache with states: PENDING → LOADING → LOADED | FAILED. Features retry logic (max 3), CORS proxy fallback, 15-second timeout, and a `disposed` flag to prevent orphaned textures from in-flight async loads. Evicted LOADED textures are disposed immediately (safe because visible cases' textures are at front of LRU).

**Key invariant**: When a GameCase3D returns to the pool, `releaseTexture()` must clear `material.albedoTexture = null` so the texture can be safely evicted.

When modifying disposal, caching, or eviction code: (1) verify texture count via `engine.getLoadedTexturesCount()`, (2) check for visual artifacts (black/gray covers), (3) measure dispose timing. Always verify resources being disposed are not still referenced by visible objects.

## Virtual Scrolling

`VirtualScrollGrid` (`imports/ui/components/VirtualScrollGrid.js`) renders only visible items plus a 12-item buffer. Uses ResizeObserver for responsive grid layout with debounced width-change detection to prevent feedback loops. Scroll handling is throttled via requestAnimationFrame + 100ms scroll-end timeout.

`ImagePreloader` (`imports/ui/lib/imagePreloader.js`) is a separate LRU cache (max 100) for HTML `<img>` elements with velocity-based directional preloading.

## Multi-Instance Deployment

Settings control which instances run background jobs:
```json
{
  "private": {
    "isWorkerInstance": true,   // Runs cover processor
    "isSchedulerInstance": true // Runs scheduled jobs (game refresh, every 24h)
  }
}
```

Both default to `true` if not set.

## Custom Games

Users can create custom games that aren't in IGDB:
- Custom games have `ownerId` field set to the creating user's ID
- Publications filter by `$or: [{ ownerId: null }, { ownerId: this.userId }]` for privacy
- Custom game methods: `games.createCustom`, `games.updateCustom`, `games.deleteCustom`, `games.uploadCustomCover`
- Covers stored in same location as IGDB covers (`cdn/covers/`)

## Schema Notes

- Games use `title` only (no `name` or `searchName` fields)
- CollectionItems use `platforms` array only (no `platform` or `gameName` fields)
- Search by game title uses `$lookup` aggregation to join with games collection

## Collection Constants

Collections export status constants - use these instead of string literals:
```javascript
import { COLLECTION_STATUSES, STATUS_LABELS } from '/imports/lib/collections/collectionItems.js';

// COLLECTION_STATUSES.BACKLOG, .PLAYING, .COMPLETED, .ABANDONED, .WISHLIST
// STATUS_LABELS.backlog → "Backlog", etc.
```

## Error Handling

Methods throw `Meteor.Error(code, message)`:
- `'not-authorized'` - user not logged in
- `'invalid-status'` - validation failed
- `'game-not-found'` - resource missing
- `'rate-limited'` - too many requests

UI displays `error.reason || error.message` in modals/toasts.
