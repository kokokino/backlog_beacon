# Backlog Beacon

A video game collection management app for the Kokokino ecosystem. Track your games, import from Darkadia, and browse your collection on a beautiful 3D bookshelf.

## Overview

Backlog Beacon is a fully functional Meteor spoke app that integrates with the Kokokino Hub for authentication and billing. It allows gamers to:

1. **Track their video game collection** – Record games you own, are playing, have completed, or plan to play
2. **Import from Darkadia** – Seamlessly import your existing collection from Darkadia CSV exports
3. **Browse in 3D** – Visualize your collection on an interactive 3D bookshelf powered by Babylon.js
4. **Stay organized** – Filter, sort, and search your collection with powerful tools

As a Kokokino spoke app, Backlog Beacon relies on the Hub for user authentication and subscription management, ensuring a secure and consistent experience across the ecosystem

## Architecture

Backlog Beacon follows the Kokokino Hub & Spoke architecture:

- **Hub** – Central authentication and billing system (`kokokino.com`)
- **Spoke** – Independent app that relies on Hub for user management

```
┌─────────────────────────────────────────────────────────────────┐
│                         KOKOKINO HUB                            │
│                    (kokokino.com:3000)                          │
│  • User accounts    • Billing    • SSO tokens    • Spoke API    │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    │ SSO Token
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKLOG BEACON                               │
│                  (localhost:3020 or your-domain)                │
│  • SSO validation  • Subscription checks  • Game collection     │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### 1. Game Collection Management                            
- Add games to your collection with status (backlog, playing, completed, abandoned)
- Rate games and add notes, hours played, and completion dates
- Filter and search by platform, genre, status, and more
- Bulk edit and delete operations

### 2. Darkadia CSV Import                               
- Import your existing collection from Darkadia CSV exports
- Intelligent game matching against the built‑in game database
- Preview unmatched games before finalizing import       
- Merge duplicates and handle conflicts gracefully

### 3. 3D Bookshelf Visualization                               
- Interactive 3D bookshelf built with Babylon.js     
- Flyweight rendering for performance with large collections  
- Click books to view game details                        
- Smooth camera controls (pan, zoom, rotate)

### 4. Self‑Hosted Game Database                           
- Built‑in database of games with metadata (title, platform, release year, cover art)
- Regular updates from open‑source game data sources      
- Admin interface for manual updates and corrections

### 5. Hub Integration                                        
- Single Sign‑On (SSO) via Kokokino Hub               
- Subscription checking (requires Base Monthly subscription)    
- Secure API communication with Hub                   
- Automatic session management                               

## Getting Started

### Prerequisites
- Meteor 3+
- Node.js 20+
- Access to a running Kokokino Hub instance (local or production)

## Preferred Tech Stack
We focus on simplicity as a super‑power:

| Technology | Purpose |
|------------|---------|
| **JavaScript** | Unified language for both server‑side and browser‑side code |
| **Meteor JS v3** | Realtime apps, user accounts, and MongoDB integration |
| **Meteor Galaxy** | To deploy our apps in the cloud |
| **Mithril JS v2.3** | General UI, using JavaScript to craft HTML |
| **Pico CSS** | Concise HTML that looks good with minimal effort |
| **Babylon JS v8** | 3D rendering and physics (with Havok JS built‑in) |
| **ostrio:files** | For serving images from disk |
| **sharp** | For converting images from JPEG to WEBP |

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/kokokino/backlog_beacon.git
   cd backlog_beacon
   ```

2. Install dependencies:
   ```bash
   meteor npm install
   ```

3. Copy the example settings file:
   ```bash
   cp settings.example.json settings.development.json
   ```

4. Configure your settings for Backlog Beacon:
   ```json
   {
     "public": {
       "appName": "Backlog Beacon",
       "appId": "backlog_beacon",
       "hubUrl": "http://localhost:3000",
       "requiredProducts": ["base_monthly"]
     },
     "private": {
       "hubApiKey": "your-backlog-beacon-api-key-from-hub",
       "hubApiUrl": "http://localhost:3000/api/spoke",
       "hubPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
     }
   }
   ```

5. Run the development server:
   ```bash
   meteor --settings settings.development.json --port 3020
   ```

### Running with Local Hub

For local development with the Hub:

1. **Start the Hub** (in another terminal):
   ```bash
   cd ../hub
   meteor --settings settings.development.json
   # Hub runs on http://localhost:3000
   ```

2. **Start Backlog Beacon**:
   ```bash
   cd ../backlog_beacon
   meteor --settings settings.development.json --port 3020
   # Backlog Beacon runs on http://localhost:3020
   ```

3. **Access the app**:
   - Visit http://localhost:3000 to log into the Hub
   - Click "Launch" on Backlog Beacon in the Hub
   - You'll be redirected to http://localhost:3020 with SSO token

## Project Structure

```
backlog_beacon/
├── client/
│   ├── main.html          # Main HTML template
│   ├── main.css           # Global styles
│   └── main.js            # Client entry point with routing
├── imports/
│   ├── hub/               # Hub integration utilities
│   │   ├── client.js      # Hub API client
│   │   ├── ssoHandler.js  # SSO token processing
│   │   └── subscriptions.js # Subscription checking
│   ├── ui/
│   │   ├── components/    # Reusable UI components
│   │   │   ├── GameCard.js
│   │   │   ├── BookshelfView.js
│   │   │   ├── ImportWizard.js
│   │   │   ├── RequireAuth.js
│   │   │   └── RequireSubscription.js
│   │   ├── layouts/       # Page layouts
│   │   │   └── MainLayout.js
│   │   └── pages/         # Route pages
│   │       ├── HomePage.js
│   │       ├── CollectionPage.js
│   │       ├── ImportPage.js
│   │       ├── BookshelfPage.js
│   │       ├── NotLoggedIn.js
│   │       ├── NoSubscription.js
│   │       ├── SessionExpired.js
│   │       ├── SsoCallback.js
│   │       └── StatisticsPage.js
│   └── lib/
│       └── collections/   # MongoDB collections
│           ├── games.js          # Game database
│           └── collectionItems.js # User collection items
├── server/
│   ├── main.js            # Server entry point
│   ├── accounts.js        # Custom login handlers
│   ├── methods.js         # Meteor methods (collection, import, etc.)
│   └── publications.js    # Data publications
├── tests/                 # Test files
├── settings.example.json  # Example configuration
└── package.json           # Dependencies
```

## Key Components

### Game Database (`imports/lib/collections/games.js`)
- Central repository of game metadata
- Regularly updated from open‑source sources
- Indexed for fast searching and filtering

### Collection Management (`imports/lib/collections/collectionItems.js`)
- Tracks user‑specific game entries
- Stores status, ratings, notes, and play history
- Linked to the game database for metadata

### 3D Bookshelf (`imports/ui/components/BookshelfView.js`)
- Babylon.js‑based 3D visualization
- Flyweight pattern for rendering thousands of books efficiently
- Interactive camera and selection

### Darkadia Import (`imports/ui/components/ImportWizard.js`)
- Step‑by‑step CSV import wizard
- Game matching algorithm
- Preview and confirmation before final import

### Hub Integration
- **SSO Handler** (`imports/hub/ssoHandler.js`) – Validates Hub tokens
- **Hub API Client** (`imports/hub/client.js`) – Communicates with Hub for subscription checks
- **RequireSubscription** (`imports/ui/components/RequireSubscription.js`) – Protects routes

## Game Database                                           

Backlog Beacon includes a self‑hosted game database that periodically syncs with IGDB.
                                                   
**Updating the database:**
```bash
# Admin method to trigger an update (requires admin privileges)
meteor call 'admin.updateGameDatabase'
```

## Development Guidelines

### Code Style
- Follow Meteor v3 async/await patterns (no fibers)
- Use Mithril.js for UI components
- Leverage Pico CSS classes for styling
- Follow security best practices for user input

### Security Considerations
- Never store Hub's private key in your code
- Always validate SSO tokens before creating sessions
- Implement rate limiting on sensitive endpoints
- Sanitize user input before display

### Performance Tips
- Use flyweight pattern for 3D bookshelf rendering
- Implement virtual scrolling for large lists
- Cache game database queries
- Use MongoDB indexes appropriately

## Testing

Run the test suite:
```bash
meteor test --driver-package meteortesting:mocha
```

Tests cover:
- SSO token validation
- Subscription checking
- Game database operations
- Collection CRUD methods
- Import functionality

## Troubleshooting

### Common Issues

1. **SSO Token Validation Fails**
   - Ensure Hub's public key is correctly configured
   - Check token expiration (tokens expire after 5 minutes)
   - Verify `appId` matches your spoke's configuration

2. **Cannot Connect to Hub API**
   - Verify `hubApiUrl` is correct in settings
   - Check that your API key is valid
   - Ensure CORS is properly configured on Hub

3. **Subscription Checks Fail**
   - Confirm user has required products in Hub
   - Check that product IDs match between Hub and spoke
   - Verify API responses are being parsed correctly

4. **Game Database Not Populated**
   - Run the database update script
   - Check that the data source files are accessible
   - Verify MongoDB connection

5. **3D Bookshelf Performance Issues**
   - Reduce the number of visible books
   - Enable Babylon.js optimizations
   - Check for memory leaks in the flyweight renderer

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](documentation/CONTRIBUTING.md) for details.

## Related Resources

- [Kokokino Hub](https://github.com/kokokino/hub) – Central authentication and billing app
- [Hub & Spoke Strategy](documentation/HUB_SPOKE_STRATEGY.md) – Architecture documentation
- [Conventions](documentation/CONVENTIONS.md) – Coding advice
- [Spoke App Skeleton](https://github.com/kokokino/spoke_app_skeleton) – Template used to create this app
- [Meteor Documentation](https://docs.meteor.com/) – Meteor framework guides
- [Mithril.js Documentation](https://mithril.js.org/) – UI framework reference

## License

MIT License – see [LICENSE](LICENSE) file for details.
