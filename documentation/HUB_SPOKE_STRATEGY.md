# Hub & Spoke Architecture Strategy

## Overview

This document outlines the strategy for extending Kokokino's Hub app to support "Spoke" applications. The Hub serves as the central authentication and billing system, while Spoke apps are independent Meteor applications that provide games, utilities, and other experiences to subscribers.

**Key Principles:**
- All code is open source and publicly visible on GitHub
- Spoke apps may be maintained by community members with varying trust levels
- Security must assume spoke maintainers could be malicious or careless
- Each spoke scales independently and can fail without affecting other apps
- Consistent tech stack (Meteor, Mithril, Pico CSS) enables community collaboration

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USERS                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         HUB APP (kokokino.com)                          │
│                                                                         │
│  • User accounts & authentication                                       │
│  • Billing & subscriptions (Lemon Squeezy)                             │
│  • SSO token generation (asymmetric JWT)                               │
│  • Spoke API endpoints                                                  │
│  • Product & App registry                                               │
│                                                                         │
│  MongoDB: users, products, apps, productOwners, appOwners              │
└─────────────────────────────────────────────────────────────────────────┘
                │                                       │
                │ SSO Token (RS256 signed)              │ API Calls
                │                                       │ (API Key auth)
                ▼                                       ▼
┌───────────────────────────┐       ┌───────────────────────────┐
│   SPOKE: App Skeleton     │       │   SPOKE: Backlog Beacon   │
│   (skeleton.kokokino.com) │       │   (backlog.kokokino.com)  │
│                           │       │                           │
│   • Validates SSO tokens  │       │   • Game collection mgmt  │
│   • Checks subscriptions  │       │   • Darkadia CSV import   │
│   • Demo chat feature     │       │   • 3D bookshelf view     │
│                           │       │   • Open source game DB   │
│   Own MongoDB instance    │       │   Own MongoDB instance    │
└───────────────────────────┘       └───────────────────────────┘
```

---

## Security Model

### Threat Model

Since all code is open source and spoke maintainers may have minimal trust:

| Threat | Mitigation |
|--------|------------|
| Malicious spoke forges user identity | Asymmetric JWT - spokes only have public key, cannot sign tokens |
| Malicious spoke accesses other users' data | Spoke API returns only data for the authenticated user |
| Compromised spoke API key | Per-spoke API keys, individually revocable, read-only access |
| Spoke reads Hub database directly | Spokes have no database access to Hub - API only |
| Man-in-the-middle attacks | HTTPS everywhere, short-lived tokens (5 minutes for SSO) |
| Replay attacks | Tokens include timestamp, nonce, and are single-use |
| Spoke impersonates Hub | Users always start at Hub, redirected to known spoke URLs |

### Authentication Layers

1. **SSO Tokens (User → Spoke)**: Asymmetric RS256 JWT signed by Hub's private key
2. **API Keys (Spoke → Hub)**: Per-spoke shared secrets for API calls
3. **Session Tokens (User ↔ Spoke)**: Standard Meteor session after SSO validation

### Key Management

```
Hub App (PRIVATE - never in git):
├── private.pem          # RSA private key for signing JWTs
└── settings.json
    └── private.spokeApiKeys: {
          "spoke_app_skeleton": "random-key-1",
          "backlog_beacon": "random-key-2"
        }

Spoke Apps (can be PUBLIC):
├── public.pem           # RSA public key for verifying JWTs (or hardcoded)
└── settings.json
    └── private.hubApiKey: "random-key-1"  # This spoke's API key
```

---

## SSO Flow (Detailed)

### Step-by-Step Flow

```
1. User clicks "Launch" on Backlog Beacon in Hub
   └── Hub: AppsList.handleLaunch(app)

2. Hub generates SSO token
   └── JWT payload: {
         userId: "abc123",
         appId: "backlog_beacon",
         productIds: ["base_monthly"],  // User's active subscriptions
         iat: 1234567890,
         exp: 1234568190,               // 5 minutes
         nonce: "random-uuid"
       }
   └── Signed with Hub's PRIVATE key (RS256)

3. Hub redirects user to spoke
   └── https://backlog.kokokino.com/sso?token=eyJhbGc...

4. Spoke receives request at /sso route
   └── Spoke: server/api/sso.js

5. Spoke validates token
   └── Verify signature with Hub's PUBLIC key
   └── Check expiration (< 5 minutes old)
   └── Check appId matches this spoke
   └── Check nonce hasn't been used (prevent replay)

6. Spoke calls Hub API to get fresh user data (optional but recommended)
   └── POST https://kokokino.com/api/spoke/user
   └── Headers: { Authorization: "Bearer <spoke-api-key>" }
   └── Body: { userId: "abc123" }
   └── Response: { username, email, subscriptions: [...] }

7. Spoke creates local session
   └── Use Meteor Accounts with custom login handler
   └── Store minimal user data locally (userId, username)
   └── Session lasts 24 hours

8. Spoke checks subscription requirements
   └── App requires: ["base_monthly"] (from app config)
   └── User has: ["base_monthly"] (from token/API)
   └── Access granted ✓

9. User sees spoke app content
```

### Token Structure

```javascript
// SSO Token (generated by Hub, verified by Spoke)
{
  // Header
  "alg": "RS256",
  "typ": "JWT"
}
{
  // Payload
  "userId": "abc123def456",
  "username": "player1",
  "email": "player1@example.com",
  "appId": "backlog_beacon",
  "appUrl": "https://backlog.kokokino.com",
  "subscriptions": [
    {
      "productId": "base_monthly_id",
      "productName": "Base Monthly",
      "status": "active",
      "validUntil": "2025-02-15T00:00:00Z"
    }
  ],
  "iat": 1234567890,
  "exp": 1234568190,
  "nonce": "550e8400-e29b-41d4-a716-446655440000"
}
// Signature (RS256 with Hub's private key)
```

### Handling Edge Cases

| Scenario | Behavior |
|----------|----------|
| Token expired | Spoke shows "Session expired, please return to Hub" |
| Token for wrong app | Spoke rejects, shows error |
| Token replay (same nonce) | Spoke rejects, logs security event |
| User subscription expired since token issued | Spoke re-checks via API, denies access |
| Hub is down | Spoke can use cached subscription data for grace period |
| User logs out of Hub | Spoke session remains until expiry (acceptable) |

---

## Hub API Endpoints

### Public Endpoints (No Auth Required)

#### GET /api/public-key
Returns the Hub's public key for JWT verification.

```javascript
// Response
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBI...",
  "algorithm": "RS256",
  "keyId": "hub-2025-01"
}
```

Spokes can call this on startup or cache the key. Key rotation would use `keyId`.

### Spoke-Authenticated Endpoints

All require header: `Authorization: Bearer <spoke-api-key>`

#### POST /api/spoke/validate-token
Validates an SSO token and marks nonce as used.

```javascript
// Request
{
  "token": "eyJhbGc..."
}

// Response (success)
{
  "valid": true,
  "userId": "abc123",
  "username": "player1",
  "email": "player1@example.com",
  "subscriptions": [...]
}

// Response (failure)
{
  "valid": false,
  "error": "token_expired" | "invalid_signature" | "wrong_app" | "nonce_reused"
}
```

#### POST /api/spoke/check-subscription
Checks if a user has an active subscription for specific products.

```javascript
// Request
{
  "userId": "abc123",
  "requiredProductIds": ["base_monthly_id"]
}

// Response
{
  "hasAccess": true,
  "subscriptions": [
    {
      "productId": "base_monthly_id",
      "status": "active",
      "validUntil": "2025-02-15T00:00:00Z"
    }
  ]
}
```

#### POST /api/spoke/user-info
Gets current user information (for session refresh).

```javascript
// Request
{
  "userId": "abc123"
}

// Response
{
  "userId": "abc123",
  "username": "player1",
  "email": "player1@example.com",
  "emailVerified": true,
  "subscriptions": [...],
  "createdAt": "2025-01-01T00:00:00Z"
}
```

### Rate Limiting

- 100 requests per minute per spoke API key
- 1000 requests per hour per spoke API key
- Exceeded limits return 429 Too Many Requests

### Error Responses

```javascript
// 401 Unauthorized (invalid/missing API key)
{
  "error": "unauthorized",
  "message": "Invalid or missing spoke API key"
}

// 403 Forbidden (valid key but not allowed for this action)
{
  "error": "forbidden",
  "message": "This spoke is not authorized for this endpoint"
}

// 429 Too Many Requests
{
  "error": "rate_limited",
  "message": "Rate limit exceeded",
  "retryAfter": 60
}

// 500 Internal Server Error
{
  "error": "internal_error",
  "message": "An unexpected error occurred"
}
```

---

## Spoke App Architecture

### Required Components

Every spoke app must implement:

1. **SSO Handler** (`/sso` route)
   - Receives token from Hub redirect
   - Validates token signature and claims
   - Creates local Meteor session
   - Redirects to app home or requested page

2. **Subscription Middleware**
   - Checks user has required subscriptions before accessing protected routes
   - Re-validates with Hub API periodically (every hour or on sensitive actions)
   - Shows appropriate message if subscription missing/expired

3. **Auth State Pages**
   - "Not Logged In" page with link to Hub
   - "Subscription Required" page with link to Hub
   - "Session Expired" page with link to Hub

4. **Hub Client Library**
   - Functions to call Hub API endpoints
   - Caching layer for subscription data
   - Error handling and retry logic

### Recommended Structure

```
spoke_app_name/
├── .meteor/
│   ├── packages
│   ├── platforms
│   └── release
├── client/
│   ├── main.html
│   ├── main.css
│   └── main.js
├── imports/
│   ├── api/
│   │   └── [app-specific collections]
│   ├── hub/
│   │   ├── client.js        # Hub API client
│   │   ├── ssoHandler.js    # SSO token processing
│   │   └── subscriptions.js # Subscription checking
│   └── ui/
│       ├── components/
│       │   └── RequireSubscription.js  # HOC for protected routes
│       ├── layouts/
│       │   └── MainLayout.js
│       └── pages/
│           ├── HomePage.js
│           ├── NotLoggedIn.js
│           ├── NoSubscription.js
│           └── SessionExpired.js
├── lib/
│   └── collections/
│       └── [app-specific]
├── server/
│   ├── main.js
│   ├── publications.js
│   └── methods.js
├── public/
│   └── [static assets]
├── private/
│   └── [server-only assets]
├── .gitignore
├── package.json
├── settings.example.json
└── README.md
```

### Settings File Structure

```javascript
// settings.example.json (committed to git - no secrets)
{
  "public": {
    "appName": "Spoke App Name",
    "appId": "spoke_app_name",
    "hubUrl": "https://kokokino.com",
    "requiredProducts": ["base_monthly"]
  },
  "private": {
    "hubApiKey": "YOUR_SPOKE_API_KEY_HERE",
    "hubApiUrl": "https://kokokino.com/api/spoke",
    "hubPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
}

// settings.development.json (NOT committed - local dev)
{
  "public": {
    "appName": "Spoke App Name",
    "appId": "spoke_app_name",
    "hubUrl": "http://localhost:3000",
    "requiredProducts": ["base_monthly"]
  },
  "private": {
    "hubApiKey": "dev-spoke-key-123",
    "hubApiUrl": "http://localhost:3000/api/spoke",
    "hubPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
}
```

---

## Backlog Beacon

### Purpose

Backlog Beacon is a video game collection management app, similar to Darkadia or Backloggery. It allows users to:
- Track games they own, are playing, or have completed
- Import collections from Darkadia CSV exports
- Browse their collection on a 3D rendered bookshelf
- (Future) Import from Steam, GOG, and other platforms

### Subscription Requirements

- Requires: Base Monthly subscription only (included in $2/month)
- No additional subscription needed

### Key Features

#### 1. Game Database (Self-Hosted)

Instead of relying on external APIs, Backlog Beacon will use a self-hosted open source game database.

**Options to evaluate:**
- **IGDB Data Export** - Comprehensive but may have licensing restrictions
- **OpenVGDB** - SQLite database, good for retro games
- **TheGamesDB** - XML dumps available
- **MobyGames** - Has data dumps for approved projects
- **LaunchBox** - XML database, very comprehensive

**Implementation:**
```javascript
// Server-side scheduled job (weekly)
SyncedCron.add({
  name: 'Update game database',
  schedule: (parser) => parser.text('at 3:00 am on Sunday'),
  job: async () => {
    await updateGameDatabase();
  }
});

// Admin method for manual update
Meteor.methods({
  'admin.updateGameDatabase'() {
    if (!isAdmin(this.userId)) throw new Meteor.Error('not-authorized');
    return updateGameDatabase();
  }
});
```

#### 2. Darkadia CSV Import

```javascript
// CSV format (example)
// "Title","Platform","Status","Rating","Notes"
// "The Legend of Zelda","NES","Completed","5","Classic!"

Meteor.methods({
  'collection.importDarkadia'(csvContent) {
    // Parse CSV
    // Match games to database entries
    // Create collection items
    // Return import summary
  }
});
```

#### 3. 3D Bookshelf (Babylon JS)

Using a flyweight/virtual scrolling pattern for performance:

```javascript
// Only render visible books + buffer
const VISIBLE_BOOKS = 50;
const BUFFER_BOOKS = 10;

class BookshelfRenderer {
  constructor(scene, collection) {
    this.scene = scene;
    this.collection = collection; // Full collection data
    this.bookMeshes = []; // Pool of reusable meshes
    this.scrollPosition = 0;
    
    // Create mesh pool
    for (let i = 0; i < VISIBLE_BOOKS + BUFFER_BOOKS; i++) {
      this.bookMeshes.push(this.createBookMesh());
    }
  }
  
  createBookMesh() {
    // Create a book-shaped mesh with placeholder texture
    const book = BABYLON.MeshBuilder.CreateBox('book', {
      width: 0.15,
      height: 0.22,
      depth: 0.03
    }, this.scene);
    return book;
  }
  
  updateVisibleBooks() {
    const startIndex = Math.floor(this.scrollPosition);
    const visibleGames = this.collection.slice(
      startIndex, 
      startIndex + VISIBLE_BOOKS
    );
    
    // Reposition and retexture mesh pool
    visibleGames.forEach((game, i) => {
      const mesh = this.bookMeshes[i];
      mesh.position = this.calculateBookPosition(startIndex + i);
      this.applyGameTexture(mesh, game);
      mesh.setEnabled(true);
    });
    
    // Hide unused meshes
    for (let i = visibleGames.length; i < this.bookMeshes.length; i++) {
      this.bookMeshes[i].setEnabled(false);
    }
  }
  
  onScroll(delta) {
    this.scrollPosition = Math.max(0, this.scrollPosition + delta);
    this.updateVisibleBooks();
  }
}
```

#### 4. Collection Data Model

```javascript
// lib/collections/games.js - The game database
Games = new Mongo.Collection('games');
// {
//   _id: "...",
//   title: "The Legend of Zelda",
//   platforms: ["NES", "GBA", "Switch"],
//   releaseYear: 1986,
//   developer: "Nintendo",
//   publisher: "Nintendo",
//   genres: ["Action", "Adventure"],
//   coverUrl: "/covers/zelda-nes.jpg",
//   // ... more metadata
// }

// lib/collections/collectionItems.js - User's collection
CollectionItems = new Mongo.Collection('collectionItems');
// {
//   _id: "...",
//   userId: "user123",
//   gameId: "game456",
//   platform: "NES",
//   status: "completed", // backlog, playing, completed, abandoned
//   rating: 5,
//   hoursPlayed: 25,
//   notes: "My favorite game!",
//   dateAdded: Date,
//   dateCompleted: Date,
//   // ... custom fields
// }
```

### GitHub Repository

- Repository: `github.com/kokokino/backlog_beacon`
- Forked from: `github.com/kokokino/spoke_app_skeleton`
- License: Same as Hub (open source)

---

## Implementation Phases

### Phase 1: Hub API Foundation

**Goal:** Add SSO and Spoke API infrastructure to the Hub app.

**Tasks:**

1. **Generate RSA Key Pair**
   - Create `private.pem` and `public.pem`
   - Add `private.pem` to `.gitignore`
   - Store private key securely (not in git)

2. **Add Dependencies**
   - `npm install jsonwebtoken` for JWT handling
   - Consider `express` or use Meteor's `WebApp` for API routes

3. **Create API Route Infrastructure**
   - `server/api/index.js` - Route setup
   - `server/api/middleware.js` - API key validation, rate limiting
   - `server/api/errors.js` - Standardized error responses

4. **Implement SSO Endpoints**
   - `GET /api/public-key` - Return public key
   - `POST /api/spoke/validate-token` - Validate SSO token

5. **Implement Spoke API Endpoints**
   - `POST /api/spoke/check-subscription`
   - `POST /api/spoke/user-info`

6. **Add Nonce Tracking**
   - Create `SsoNonces` collection
   - Store used nonces with expiration
   - Clean up expired nonces periodically

7. **Update AppsList Component**
   - Modify `handleLaunch()` to generate SSO token
   - Redirect to spoke URL with token

8. **Add Spoke Registration**
   - Create `Spokes` collection in Hub
   - Store spoke metadata: appId, name, url, apiKey, requiredProducts
   - Admin UI for managing spokes (future)

9. **Update Settings**
   - Add `private.jwtPrivateKey` or use Assets
   - Add `private.spokeApiKeys` object
   - Document in `settings.example.json`

10. **Testing**
    - Unit tests for token generation/validation
    - Integration tests for API endpoints
    - Manual testing with curl/Postman

**Files to Create/Modify:**

```
hub/
├── server/
│   ├── api/
│   │   ├── index.js          # NEW: API route setup
│   │   ├── middleware.js     # NEW: Auth middleware
│   │   ├── sso.js            # NEW: SSO endpoints
│   │   └── spoke.js          # NEW: Spoke API endpoints
│   └── main.js               # MODIFY: Initialize API routes
├── lib/
│   └── collections/
│       ├── spokes.js         # NEW: Spoke registry
│       └── ssoNonces.js      # NEW: Nonce tracking
├── imports/
│   └── ui/
│       └── components/
│           └── AppsList.js   # MODIFY: handleLaunch()
├── private/
│   └── keys/
│       └── .gitkeep          # Private key goes here (not committed)
├── package.json              # MODIFY: Add jsonwebtoken
└── settings.example.json     # MODIFY: Document new settings
```

**Estimated Effort:** 2-3 sessions

---

### Phase 2: Backlog Beacon (Initial)

**Goal:** Fork skeleton and implement core collection management features.

**Tasks:**

1. **Fork Spoke App Skeleton**
   - Create new repo from skeleton
   - Update app name and settings
   - Verify SSO still works

2. **Design Data Models**
   - `Games` collection (database)
   - `CollectionItems` collection (user data)
   - Indexes for performance

3. **Implement Game Database**
   - Choose and integrate open source DB
   - Create import/sync scripts
   - Admin controls for updates

4. **Implement Collection CRUD**
   - Add game to collection
   - Update status/rating/notes
   - Remove from collection
   - List/filter/sort collection

5. **Implement Darkadia Import**
   - CSV parsing
   - Game matching algorithm
   - Import preview and confirmation
   - Error handling for unmatched games

6. **Create Collection UI**
   - List view with filters
   - Game detail view
   - Add/edit forms
   - Import wizard

7. **Testing**
   - Test with sample Darkadia exports
   - Test large collections (1000+ games)
   - Performance testing

**Estimated Effort:** 3-4 sessions

---

### Phase 3: Backlog Beacon (3D Bookshelf)

**Goal:** Add the 3D bookshelf visualization using Babylon JS.

**Tasks:**

1. **Add Babylon JS**
   - Install dependencies
   - Set up scene and camera
   - Basic lighting

2. **Create Bookshelf Model**
   - Shelf geometry
   - Book slot positions
   - Camera controls (pan, zoom)

3. **Implement Flyweight Pattern**
   - Mesh pool for books
   - Virtual scrolling logic
   - Texture management

4. **Add Book Rendering**
   - Book mesh with spine texture
   - Cover art loading
   - Placeholder for missing art

5. **Add Interactivity**
   - Click book to view details
   - Hover effects
   - Smooth scrolling

6. **Performance Optimization**
   - LOD (Level of Detail) for distant books
   - Texture atlasing
   - Lazy loading

7. **Testing**
   - Test with 5000+ game collection
   - Test on various devices
   - FPS monitoring

**Estimated Effort:** 3-4 sessions

---

### Phase 4: Backlog Beacon (Platform Imports)

**Goal:** Add ability to import from Steam, GOG, and other platforms.

**Tasks:**

1. **Steam Import**
   - Steam Web API integration
   - OAuth or API key setup
   - Game matching to database

2. **GOG Import**
   - GOG Galaxy database reading
   - Or GOG API if available

3. **Other Platforms**
   - Epic Games Store
   - PlayStation (if API available)
   - Xbox (if API available)
   - Nintendo (manual likely)

4. **Duplicate Detection**
   - Identify same game across platforms
   - Merge or keep separate options

**Estimated Effort:** 2-3 sessions per platform

---

## Local Development Setup

### Directory Structure

```
~/Documents/programming/kokokino/
├── hub/                      # Port 3000
├── spoke_app_skeleton/       # Port 3010
├── backlog_beacon/           # Port 3020
└── documentation/            # Shared docs (optional)
```

### Running Multiple Apps

**Terminal 1 - Hub:**
```bash
cd ~/Documents/programming/kokokino/hub
meteor --settings settings.development.json
# Running at http://localhost:3000
```

**Terminal 2 - Spoke:**
```bash
cd ~/Documents/programming/kokokino/spoke_app_skeleton
meteor --port 3010 --settings settings.development.json
# Running at http://localhost:3010
```

### Development Settings

**hub/settings.development.json:**
```json
{
  "public": {
    "appName": "Kokokino Hub (Dev)"
  },
  "private": {
    "MAIL_URL": "smtp://...",
    "jwtPrivateKeyPath": "private/keys/private.pem",
    "spokeApiKeys": {
      "spoke_app_skeleton": "dev-skeleton-key-123",
      "backlog_beacon": "dev-backlog-key-456"
    },
    "spokes": {
      "spoke_app_skeleton": {
        "url": "http://localhost:3010",
        "name": "Spoke App Skeleton"
      },
      "backlog_beacon": {
        "url": "http://localhost:3020",
        "name": "Backlog Beacon"
      }
    },
    "lemonSqueezy": {
      "...": "..."
    }
  }
}
```

**spoke_app_skeleton/settings.development.json:**
```json
{
  "public": {
    "appName": "Spoke App Skeleton (Dev)",
    "appId": "spoke_app_skeleton",
    "hubUrl": "http://localhost:3000",
    "requiredProducts": []
  },
  "private": {
    "hubApiKey": "dev-skeleton-key-123",
    "hubApiUrl": "http://localhost:3000/api/spoke",
    "hubPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
}
```

### Generating RSA Keys (One-Time Setup)

```bash
# Generate private key
openssl genrsa -out private.pem 2048

# Extract public key
openssl rsa -in private.pem -pubout -out public.pem

# Move private key to hub (NEVER commit this)
mv private.pem ~/Documents/programming/kokokino/hub/private/keys/

# Public key can be shared/committed
cat public.pem
# Copy this to spoke settings or commit to spoke repos
```

---

## Production Deployment (Meteor Galaxy)

### Domain Structure

- `kokokino.com` - Hub app
- `skeleton.kokokino.com` - Spoke App Skeleton
- `backlog.kokokino.com` - Backlog Beacon

### Deployment Commands

```bash
# Deploy Hub
cd hub
DEPLOY_HOSTNAME=us-east-1.galaxy-deploy.meteor.com meteor deploy kokokino.com --settings settings.production.json

# Deploy Spoke
cd spoke_app_skeleton
DEPLOY_HOSTNAME=us-east-1.galaxy-deploy.meteor.com meteor deploy skeleton.kokokino.com --settings settings.production.json
```

### Environment Variables

Set in Galaxy dashboard or via `settings.production.json`:

**Hub:**
- `MAIL_URL` - Email sending
- `MONGO_URL` - MongoDB connection (Galaxy provides)
- `ROOT_URL` - `https://kokokino.com`

**Spokes:**
- `MONGO_URL` - Each spoke has its own MongoDB
- `ROOT_URL` - `https://skeleton.kokokino.com`

### SSL/HTTPS

Galaxy provides automatic SSL certificates for custom domains.

---

## Security Checklist

### Hub App

- [ ] Private key stored securely (not in git)
- [ ] API keys are randomly generated (32+ characters)
- [ ] Rate limiting on all API endpoints
- [ ] Nonce tracking prevents token replay
- [ ] Tokens expire after 5 minutes
- [ ] All API responses sanitize user data
- [ ] Logging for security events (failed auth, etc.)

### Spoke Apps

- [ ] Only Hub's public key is stored (not private)
- [ ] API key stored in settings (not in code)
- [ ] Token validation checks all claims (exp, appId, etc.)
- [ ] Subscription re-validated periodically
- [ ] No direct database access to Hub
- [ ] User input sanitized
- [ ] XSS prevention in chat/user content

### General

- [ ] HTTPS everywhere in production
- [ ] CORS configured appropriately
- [ ] Dependencies regularly updated
- [ ] Security headers set (CSP, etc.)

---

## Future Considerations

### Key Rotation

When rotating the Hub's RSA keys:
1. Generate new key pair with new `keyId`
2. Hub signs with new key, includes `keyId` in token header
3. Spokes fetch `/api/public-key` and cache both old and new keys
4. Spokes try new key first, fall back to old
5. After transition period, remove old key

### Multi-Region Deployment

If Kokokino grows to need multiple regions:
- Hub could be deployed to multiple regions with shared MongoDB
- Spokes can be deployed independently per region
- SSO tokens work across regions (stateless)

### Spoke Marketplace

Future feature for community-contributed spokes:
- Spoke registration/approval process
- Automated API key provisioning
- Usage analytics per spoke
- Revenue sharing for premium spokes

---

## Glossary

| Term | Definition |
|------|------------|
| **Hub** | Central Kokokino app managing users, auth, and billing |
| **Spoke** | Independent app that integrates with Hub for auth |
| **SSO** | Single Sign-On - logging into spoke via Hub |
| **JWT** | JSON Web Token - signed token for SSO |
| **RS256** | RSA signature with SHA-256 - asymmetric JWT signing |
| **Nonce** | Number used once - prevents token replay attacks |
| **Flyweight** | Design pattern for efficiently rendering many similar objects |

---

## References

- [Meteor Guide](https://guide.meteor.com/)
- [Mithril.js Documentation](https://mithril.js.org/)
- [JSON Web Tokens](https://jwt.io/)
- [Pico CSS](https://picocss.com/)
- [Babylon.js Documentation](https://doc.babylonjs.com/)
- [Lemon Squeezy API](https://docs.lemonsqueezy.com/)

---

*Last updated: 2025-01-18*
*Document version: 1.0*
