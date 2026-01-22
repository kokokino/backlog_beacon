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

## Architecture

### Hub & Spoke SSO Flow
1. User logs into Hub at kokokino.com
2. Clicks "Launch Backlog Beacon" → Hub generates RS256 JWT with nonce
3. Browser redirects to `/sso?token=<JWT>`
4. App validates signature with Hub's public key, checks nonce for replay
5. User created/updated locally, session established

### Key Directories
- `imports/hub/` - SSO validation, Hub API client, subscription checks
- `imports/ui/` - Mithril components (pages/, components/, layouts/)
- `imports/lib/collections/` - MongoDB collections (games, collectionItems, storefronts)
- `server/covers/` - Background cover image processing queue
- `server/migrations/` - Sequential database migrations
- `cdn/` - Generated cover images (gitignored)

### Data Flow
- **Publications** stream reactive data via `Meteor.subscribe()`
- **Methods** handle mutations via `Meteor.callAsync()`
- **Tracker.autorun()** triggers Mithril redraws on data changes

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
- `RequireAuth` HOC - redirects unauthenticated users
- `RequireSubscription` HOC - checks product access via Hub
