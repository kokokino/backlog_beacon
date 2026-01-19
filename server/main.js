import { Meteor } from 'meteor/meteor';
import { Games } from '../imports/lib/collections/games.js';
import { CollectionItems } from '../imports/lib/collections/collectionItems.js';

import './accounts.js';
import './methods.js';
import './publications.js';

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
  
  try {
    await Games.createIndexAsync({ igdbId: 1 }, { unique: true, sparse: true });
    await Games.createIndexAsync({ title: 'text' });
    await Games.createIndexAsync({ slug: 1 });
    await Games.createIndexAsync({ platforms: 1 });
    await Games.createIndexAsync({ genres: 1 });
    await Games.createIndexAsync({ releaseYear: 1 });
    console.log('Games collection indexes created');
  } catch (error) {
    console.error('Error creating Games indexes:', error.message);
  }
  
  try {
    await CollectionItems.createIndexAsync({ userId: 1 });
    await CollectionItems.createIndexAsync({ userId: 1, gameId: 1, platform: 1 }, { unique: true });
    await CollectionItems.createIndexAsync({ userId: 1, status: 1 });
    await CollectionItems.createIndexAsync({ userId: 1, favorite: 1 });
    await CollectionItems.createIndexAsync({ gameId: 1 });
    console.log('CollectionItems collection indexes created');
  } catch (error) {
    console.error('Error creating CollectionItems indexes:', error.message);
  }
  
  console.log('Backlog Beacon server started');
});
