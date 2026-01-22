import { Meteor } from 'meteor/meteor';
import { Migrations } from 'meteor/quave:migrations';
import { Games } from '../imports/lib/collections/games.js';
import { CollectionItems } from '../imports/lib/collections/collectionItems.js';
import { Storefronts } from '../imports/lib/collections/storefronts.js';
import { ImportProgress } from '../imports/lib/collections/importProgress.js';

import './accounts.js';
import './methods.js';
import './publications.js';

// Import IGDB integration
import './igdb/client.js';
import './igdb/gameCache.js';

// Import cover image handling
import { startCoverProcessor } from './covers/index.js';

// Import additional methods
import './methods/igdbMethods.js';
import './methods/importMethods.js';

// Import additional publications
import './publications/importProgressPublication.js';

// Import scheduled jobs
import './scheduled/gameRefresh.js';

// Import migrations
import './migrations/0_steps.js';

// Configure migrations
Migrations.config({
  log: true,
  logger: null,
  logIfLatest: true,
  collectionName: 'migrations'
});

Meteor.startup(async () => {
  console.log('Backlog Beacon server starting...');
  
  const settings = Meteor.settings;
  
  if (!settings.public?.hubUrl) {
    console.warn('Warning: settings.public.hubUrl is not configured');
  }
  
  if (!settings.private?.hubApiKey) {
    console.warn('Warning: settings.private.hubApiKey is not configured');
  }
  
  if (!settings.private?.hubPublicKey) {
    console.warn('Warning: settings.private.hubPublicKey is not configured');
  }
  
  // Check IGDB configuration
  const igdbConfigured = settings.private?.igdb?.clientId && settings.private?.igdb?.clientSecret;
  if (igdbConfigured) {
    console.log('IGDB integration is configured');
  } else {
    console.warn('Warning: IGDB credentials not configured - game search will be limited to local cache');
  }
  
  // Run migrations
  console.log('=== MIGRATIONS STARTUP ===');
  console.log('Checking for pending migrations...');
  
  try {
    const currentVersion = await Migrations.getVersion();
    console.log('Current migration version in DB:', currentVersion);
    
    console.log('Attempting to migrate to latest...');
    await Migrations.migrateTo('latest');
    
    const newVersion = await Migrations.getVersion();
    console.log(`✓ Migrations completed successfully. Now at version ${newVersion}`);
  } catch (error) {
    console.error('Error running migrations:', error);
    console.error('Error stack:', error.stack);
  }
  
  // Start cover image processor (only on worker instance for multi-instance deployments)
  const isWorkerInstance = Meteor.settings.private?.isWorkerInstance !== false;
  if (isWorkerInstance) {
    console.log('Starting cover image processor (worker instance)...');
    startCoverProcessor();
  } else {
    console.log('Cover processor disabled (not a worker instance)');
  }
  
  // Debug: Check collection counts
  const gamesCount = await Games.find().countAsync();
  const collectionItemsCount = await CollectionItems.find().countAsync();
  const storefrontsCount = await Storefronts.find().countAsync();
  console.log(`Database status: ${gamesCount} games, ${collectionItemsCount} collection items, ${storefrontsCount} storefronts`);
  
  console.log('Backlog Beacon server started');
});
