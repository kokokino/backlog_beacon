import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Games } from '../imports/lib/collections/games.js';
import { CollectionItems } from '../imports/lib/collections/collectionItems.js';

Meteor.publish('userCollection', function(options = {}) {
  check(options, {
    status: Match.Maybe(String),
    platform: Match.Maybe(String),
    favorite: Match.Maybe(Boolean),
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
    query.platform = options.platform;
  }
  
  if (options.favorite === true) {
    query.favorite = true;
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

Meteor.publish('collectionGames', function() {
  if (!this.userId) {
    this.ready();
    return;
  }
  
  const items = CollectionItems.find({ userId: this.userId }).fetch();
  const gameIds = items.map(item => item.gameId);
  
  if (gameIds.length > 0) {
    return Games.find({ _id: { $in: gameIds } });
  }
  
  this.ready();
  return;
});

Meteor.publish('game', function(gameId) {
  check(gameId, String);
  
  if (!this.userId) {
    this.ready();
    return;
  }
  
  return Games.find({ _id: gameId });
});

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
    searchQuery.title = { $regex: query.trim(), $options: 'i' };
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
    sort: { title: 1 },
    fields: {
      title: 1,
      slug: 1,
      platforms: 1,
      releaseYear: 1,
      genres: 1,
      coverImageId: 1,
      igdbCoverUrl: 1
    }
  });
});

Meteor.publish('gamesBrowse', function(options = {}) {
  check(options, {
    limit: Match.Maybe(Number),
    skip: Match.Maybe(Number),
    sort: Match.Maybe(Object)
  });
  
  if (!this.userId) {
    this.ready();
    return;
  }
  
  const findOptions = {
    sort: options.sort || { title: 1 },
    limit: Math.min(options.limit || 50, 200),
    fields: {
      title: 1,
      slug: 1,
      platforms: 1,
      releaseYear: 1,
      genres: 1,
      coverImageId: 1,
      igdbCoverUrl: 1
    }
  };
  
  if (options.skip) {
    findOptions.skip = options.skip;
  }
  
  return Games.find({}, findOptions);
});

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
