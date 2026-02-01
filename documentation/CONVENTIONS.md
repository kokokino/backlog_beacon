# Kokokino Conventions

## Overview
Kokokino is an open‑source COOP where creative people write games and learn from each other.  
All games are open source but monetized through monthly subscriptions to keep the servers running.

## Subscription Model
- **Base monthly charge**: $2  
  Grants access to fundamental apps and games, such as **Backlog Beacon** (for tracking your personal video game collection).
- **Additional subscriptions**: Some ambitious games may require extra monthly charges to cover their scope and development costs.  
  This model allows novices to contribute while enabling advanced creators to earn a full‑time living from their games.

## Tech Stack
We focus on simplicity as a super‑power:

| Technology | Purpose |
|------------|---------|
| **JavaScript** | Unified language for both server‑side and browser‑side code |
| **Meteor JS v3** | Realtime apps, user accounts, and MongoDB integration |
| **Meteor Galaxy** | To deploy our apps in the cloud |
| **Mithril JS v2.3** | General UI, using JavaScript to craft HTML |
| **Pico CSS** | Concise HTML that looks good with minimal effort |
| **Babylon JS v8** | 3D rendering and physics (with Havok JS built‑in) |
| **Lemon Squeezy** | Billing and subscription management |

## The Hub App
The **Hub** is the central application users see when visiting `http://kokokino.com`.  
It provides:

- User account management
- Billing and subscription handling
- Single Sign‑On (SSO) for all other Kokokino apps (e.g., **App Skeleton**, **Backlog Beacon** and other community apps)

The name “Hub” evokes a wheel where spokes (individual apps) connect back to the center.

## App Structure
- **Hub** – A standalone app that serves as the central entry point and SSO provider.
- **App Skeleton** – Minimal sample spoke to fork your own project. Has chat that works like a poor man's Discord. Included in the standard $2 monthly charge.  
- **Backlog Beacon** – Place to track your video game collection. Included in the standard $2 monthly charge.  
  Other ambitious projects may require their own monthly charge.

Each app is provisioned separately, allowing independent development and deployment while relying on the Hub for authentication and billing.

## Development Philosophy
1. **Open source** – All code is publicly available for learning and collaboration.
2. **Simplicity** – Choose tools that reduce cognitive overhead and speed up development.
3. **Real‑time by default** – Leverage Meteor for live updates and seamless user experiences.
4. **Modularity** – Keep apps decoupled but connected through the Hub’s SSO and billing services.

## Contributing
We welcome contributions from developers, designers, and game creators of all skill levels.  
Check the individual app repositories for contribution guidelines and issue trackers.

## Meteor style guide
1. Many older Meteor package won't work since we are focused on Meteor v3 and there are breaking changes mostly around deprecating asynchronous fibers and using modern async/await functions.
2. Must use async/await pattern with many method calls since we are no longer using fibers for asynchronous calls
3. When implementing Meteor calls, subscriptions, publications, collections, etc, please use the modern Meteor v3 API without fibers.
4. When recommending Atmosphere packages try to pick ones that are Meteor v3 compatible. 
5. Packages `autopublish` and `insecure` are purposely not installed. They are for rapid prototyping at a hackathon, not for deployed code. Do not suggest for these to be installed and advise developers not to use these packages. 

## UI style guide
1. Try to leverage PICO.css design patterns as much as possible so we don't re-invent the wheel. 
2. Avoid inline styles. 
3. Use meaningful CSS class names and ids such as "warning" instead "yellow" but then in the CSS file you can make it a yellow color. 
4. Use Mithril as much as possible but it's ok to integrate with Blaze at times for packages such as accounts-ui. Avoid using other libraries like React as much as possible unless specifically instructed to do so for a very particular reason. Mithril is good at being able to play nice with other UI libraries and frameworks when needed. 

## Javascript style guide
1. Always think about security and protecting from malicious users.
2. Think about rate limiting and potential exploits.
3. Always use curly braces with "if" blocks even if they are very simple.
4. Avoid early returns as much as possible. Prefer for functions to have a single return statement at the end.
5. Use keyword "const" for variable names as much as possible unless it needs to be "let" and generally avoid the use of "var".
6. Every variable declaration should be on its own line. Do not use the comma syntax to define multiple at once.
7. Give every variable a readable word name like "document" and avoid acronyms like "doc" - The only exception is simple counters where a variable like "i" can be acceptable but even then "count" is preferred.

## Method pattern
All Meteor methods should follow this structure:
1. Validate inputs with `check()` and `Match`
2. Check authentication: `if (!this.userId) throw new Meteor.Error('not-authorized', ...)`
3. Call rate limiting: `await checkRateLimit(this.userId, 'methodName')`
4. Perform business logic
5. Return explicit values

## Publication pattern
All publications should:
1. Check `this.userId` first, call `this.ready()` if not authenticated
2. Use explicit field projections for security and performance
3. Cap pagination limits: `Math.min(options.limit || 50, 200)`

## Collection constants
Export status constants from collection files and use them instead of string literals:
```javascript
export const COLLECTION_STATUSES = {
  BACKLOG: 'backlog',
  PLAYING: 'playing',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  WISHLIST: 'wishlist'
};
```

## Migration naming
Database migrations use sequential numbering: `1_create_indexes.js`, `2_seed_storefronts.js`, etc.

## Rate limiting
Use distributed rate limiting via MongoDB atomic operations for multi-instance safety:
- Window-based: 10 requests per second per user for methods
- Cooldown-based: one request per interval for sensitive operations

---
*Last updated: 2026‑01‑31*
