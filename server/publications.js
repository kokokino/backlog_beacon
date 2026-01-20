import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Games } from '../imports/lib/collections/games.js';
import { CollectionItems } from '../imports/lib/collections/collectionItems.js';
import { Storefronts } from '../imports/lib/collections/storefronts.js';

// Publish user's collection with filters
Meteor.publish('userCollection', function(options = {}) {
  check(options, {
    status: Match.Maybe(String),
    platform: Match.Maybe(String),
    storefront: Match.Maybe(String),
    favorite: Match.Maybe(Boolean),
    search: Match.Maybe(String),
    limit: Match.Maybe(Number),
    skip: Match.Maybe(Number),
    sort: Match.Maybe(Object)
  });
  
  if (!this.userId) {
    this.ready();
    return;
  }
  
  const query = { userId: this.userId };
  
  if (options.status) {
    query.status = options.status;
  }
  
  if (options.platform) {
    query.$or = [
      { platforms: options.platform },
      { platform: options.platform }
    ];
  }
  
  if (options.storefront) {
    query.storefronts = options.storefront;
  }
  
  if (options.favorite === true) {
    query.favorite = true;
  }
  
  if (options.search && options.search.trim().length > 0) {
    query.gameName = { $regex: options.search.trim(), $options: 'i' };
  }
  
  const findOptions = {
    sort: options.sort || { dateAdded: -1 },
    limit: Math.min(options.limit || 50, 200)
  };
  
  if (options.skip) {
    findOptions.skip = options.skip;
  }
  
  return CollectionItems.find(query, findOptions);
});

// Publish games for user's collection items
Meteor.publish('collectionGames', async function() {
  if (!this.userId) {
    this.ready();
    return;
  }
  
  const itemsCursor = CollectionItems.find({ userId: this.userId });
  const items = await itemsCursor.fetchAsync();
  const gameIds = items.map(item => item.gameId).filter(Boolean);
  
  if (gameIds.length > 0) {
    return Games.find({ _id: { $in: gameIds } });
  }
  
  this.ready();
  return;
});

// Publish games by IDs (for collection display)
Meteor.publish('gamesByIds', function(gameIds) {
  check(gameIds, [String]);
  
  if (!this.userId) {
    this.ready();
    return;
  }
  
  if (gameIds.length === 0) {
    this.ready();
    return;
  }
  
  // Limit to prevent abuse
  const limitedIds = gameIds.slice(0, 500);
  
  return Games.find(
    { _id: { $in: limitedIds } },
    {
      fields: {
        _id: 1,
        igdbId: 1,
        title: 1,
        name: 1,
        slug: 1,
        summary: 1,
        platforms: 1,
        genres: 1,
        releaseYear: 1,
        developer: 1,
        publisher: 1,
        coverUrl: 1,
        coverImageId: 1,
        igdbCoverUrl: 1,
        localCoverId: 1,
        localCoverUrl: 1,
        rating: 1
      }
    }
  );
});

// Publish single game
Meteor.publish('game', function(gameId) {
  check(gameId, String);
  
  if (!this.userId) {
    this.ready();
    return;
  }
  
  return Games.find({ _id: gameId });
});

// Publish games for search/browse
Meteor.publish('gamesSearch', function(query = '', options = {}) {
  check(query, String);
  check(options, {
    platform: Match.Maybe(String),
    genre: Match.Maybe(String),
    limit: Match.Maybe(Number)
  });
  
  if (!this.userId) {
    this.ready();
    return;
  }
  
  const searchQuery = {};
  
  if (query && query.trim()) {
    const searchTerm = query.trim();
    searchQuery.$or = [
      { title: { $regex: searchTerm, $options: 'i' } },
      { name: { $regex: searchTerm, $options: 'i' } },
      { searchName: { $regex: searchTerm.toLowerCase(), $options: 'i' } }
    ];
  }
  
  if (options.platform) {
    searchQuery.platforms = options.platform;
  }
  
  if (options.genre) {
    searchQuery.genres = options.genre;
  }
  
  const limit = Math.min(options.limit || 20, 100);
  
  return Games.find(searchQuery, {
    limit: limit,
    sort: { title: 1, name: 1 },
    fields: {
      _id: 1,
      igdbId: 1,
      title: 1,
      name: 1,
      slug: 1,
      platforms: 1,
      releaseYear: 1,
      genres: 1,
      coverImageId: 1,
      coverUrl: 1,
      igdbCoverUrl: 1,
      localCoverId: 1,
      localCoverUrl: 1,
      developer: 1
    }
  });
});

// Publish games for browsing (paginated)
Meteor.publish('gamesBrowse', function(options = {}) {
  check(options, {
    search: Match.Maybe(String),
    genre: Match.Maybe(String),
    platform: Match.Maybe(String),
    limit: Match.Maybe(Number),
    skip: Match.Maybe(Number),
    sort: Match.Maybe(Object)
  });
  
  if (!this.userId) {
    this.ready();
    return;
  }
  
  const query = {};
  
  if (options.search && options.search.trim().length > 0) {
    const searchTerm = options.search.trim().toLowerCase();
    query.$or = [
      { searchName: { $regex: searchTerm, $options: 'i' } },
      { title: { $regex: searchTerm, $options: 'i' } },
      { name: { $regex: searchTerm, $options: 'i' } }
    ];
  }
  
  if (options.genre) {
    query.genres = options.genre;
  }
  
  if (options.platform) {
    query.platforms = options.platform;
  }
  
  const findOptions = {
    sort: options.sort || { title: 1, name: 1 },
    limit: Math.min(options.limit || 50, 200),
    fields: {
      _id: 1,
      igdbId: 1,
      title: 1,
      name: 1,
      slug: 1,
      platforms: 1,
      releaseYear: 1,
      genres: 1,
      coverImageId: 1,
      coverUrl: 1,
      igdbCoverUrl: 1,
      localCoverId: 1,
      localCoverUrl: 1,
      developer: 1
    }
  };
  
  if (options.skip) {
    findOptions.skip = options.skip;
  }
  
  return Games.find(query, findOptions);
});

// Publish user data for auth
Meteor.publish('userData', function() {
  if (!this.userId) {
    return this.ready();
  }
  
  return Meteor.users.find(
    { _id: this.userId },
    { 
      fields: { 
        username: 1,
        emails: 1,
        subscriptions: 1,
        'services.sso.hubUserId': 1
      } 
    }
  );
});

// Publish distinct platforms from user's collection (for filters)
Meteor.publish('collectionPlatforms', function() {
  if (!this.userId) {
    this.ready();
    return;
  }
  
  // Return collection items with just platforms field for aggregation on client
  return CollectionItems.find(
    { userId: this.userId },
    { fields: { platforms: 1, platform: 1 } }
  );
});

// Publish distinct storefronts from user's collection (for filters)
Meteor.publish('collectionStorefronts', function() {
  if (!this.userId) {
    this.ready();
    return;
  }
  
  return CollectionItems.find(
    { userId: this.userId },
    { fields: { storefronts: 1 } }
  );
});

// Publish all active storefronts
Meteor.publish('storefronts', function() {
  return Storefronts.find(
    { isActive: true },
    { sort: { sortOrder: 1 } }
  );
});

// Publish storefronts by category
Meteor.publish('storefrontsByCategory', function(category) {
  check(category, String);
  
  return Storefronts.find(
    { isActive: true, category: category },
    { sort: { sortOrder: 1 } }
  );
});
