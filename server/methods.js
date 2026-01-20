import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { check, Match } from 'meteor/check';
import { Games } from '../imports/lib/collections/games.js';
import { CollectionItems, COLLECTION_STATUSES } from '../imports/lib/collections/collectionItems.js';
import { checkSubscription } from '../imports/hub/subscriptions.js';
import { getValidStorefrontIds } from '../imports/lib/constants/storefronts.js';

const rateLimiter = new Map();
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 10;

function checkRateLimit(userId, methodName) {
  const key = `${userId}:${methodName}`;
  const now = Date.now();
  const record = rateLimiter.get(key);
  
  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
    rateLimiter.set(key, { timestamp: now, count: 1 });
    return true;
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    throw new Meteor.Error('rate-limited', 'Too many requests. Please slow down.');
  }
  
  record.count++;
  return true;
}

const validStatuses = Object.values(COLLECTION_STATUSES);

function validateStatus(status) {
  if (!validStatuses.includes(status)) {
    throw new Meteor.Error('invalid-status', `Status must be one of: ${validStatuses.join(', ')}`);
  }
}

function validateRating(rating) {
  if (rating !== null && rating !== undefined) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Meteor.Error('invalid-rating', 'Rating must be an integer between 1 and 5');
    }
  }
}

function validateStorefronts(storefronts) {
  if (!storefronts || storefronts.length === 0) {
    return [];
  }
  const validIds = getValidStorefrontIds();
  return storefronts.filter(id => validIds.includes(id));
}

Meteor.methods({
  async 'collection.addItem'(gameId, platform, status = 'backlog', options = {}) {
    check(gameId, String);
    check(platform, String);
    check(status, String);
    check(options, {
      storefronts: Match.Maybe([String]),
      notes: Match.Maybe(String),
      platforms: Match.Maybe([String])
    });
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    checkRateLimit(this.userId, 'collection.addItem');
    validateStatus(status);
    
    const game = await Games.findOneAsync(gameId);
    if (!game) {
      throw new Meteor.Error('game-not-found', 'Game not found');
    }
    
    // Check for existing item by gameId
    const existing = await CollectionItems.findOneAsync({
      userId: this.userId,
      gameId: gameId
    });
    
    if (existing) {
      throw new Meteor.Error('duplicate-item', 'This game is already in your collection');
    }
    
    const now = new Date();
    const storefronts = validateStorefronts(options.storefronts || []);
    const platforms = options.platforms || [platform];
    
    const itemId = await CollectionItems.insertAsync({
      userId: this.userId,
      gameId: gameId,
      igdbId: game.igdbId || null,
      gameName: game.title || game.name || '',
      platform: platform,
      platforms: platforms,
      storefronts: storefronts,
      status: status,
      rating: null,
      hoursPlayed: null,
      notes: options.notes || '',
      dateAdded: now,
      dateStarted: null,
      dateCompleted: null,
      favorite: false,
      physical: false,
      createdAt: now,
      updatedAt: now
    });
    
    return itemId;
  },
  
  async 'collection.updateItem'(itemId, updates) {
    check(itemId, String);
    check(updates, {
      status: Match.Maybe(String),
      rating: Match.Maybe(Match.OneOf(Number, null)),
      hoursPlayed: Match.Maybe(Match.OneOf(Number, null)),
      notes: Match.Maybe(String),
      dateStarted: Match.Maybe(Match.OneOf(Date, null)),
      dateCompleted: Match.Maybe(Match.OneOf(Date, null)),
      favorite: Match.Maybe(Boolean),
      physical: Match.Maybe(Boolean),
      platform: Match.Maybe(String),
      platforms: Match.Maybe([String]),
      storefronts: Match.Maybe([String])
    });
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    checkRateLimit(this.userId, 'collection.updateItem');
    
    const item = await CollectionItems.findOneAsync(itemId);
    if (!item) {
      throw new Meteor.Error('item-not-found', 'Collection item not found');
    }
    
    if (item.userId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only update your own collection items');
    }
    
    if (updates.status !== undefined) {
      validateStatus(updates.status);
    }
    
    if (updates.rating !== undefined) {
      validateRating(updates.rating);
    }
    
    if (updates.hoursPlayed !== undefined && updates.hoursPlayed !== null) {
      if (typeof updates.hoursPlayed !== 'number' || updates.hoursPlayed < 0) {
        throw new Meteor.Error('invalid-hours', 'Hours played must be a positive number');
      }
    }
    
    if (updates.notes !== undefined && updates.notes.length > 10000) {
      throw new Meteor.Error('notes-too-long', 'Notes cannot exceed 10000 characters');
    }
    
    // Validate storefronts if provided
    if (updates.storefronts !== undefined) {
      updates.storefronts = validateStorefronts(updates.storefronts);
    }
    
    const updateFields = { ...updates, updatedAt: new Date() };
    
    // Auto-set dateCompleted when marking as completed
    if (updates.status === 'completed' && !item.dateCompleted && !updates.dateCompleted) {
      updateFields.dateCompleted = new Date();
    }
    
    const result = await CollectionItems.updateAsync(itemId, { $set: updateFields });
    return result;
  },
  
  async 'collection.removeItem'(itemId) {
    check(itemId, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    checkRateLimit(this.userId, 'collection.removeItem');
    
    const item = await CollectionItems.findOneAsync(itemId);
    if (!item) {
      throw new Meteor.Error('item-not-found', 'Collection item not found');
    }
    
    if (item.userId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only remove your own collection items');
    }
    
    const result = await CollectionItems.removeAsync(itemId);
    return result;
  },
  
  async 'collection.toggleFavorite'(itemId) {
    check(itemId, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    checkRateLimit(this.userId, 'collection.toggleFavorite');
    
    const item = await CollectionItems.findOneAsync(itemId);
    if (!item) {
      throw new Meteor.Error('item-not-found', 'Collection item not found');
    }
    
    if (item.userId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only update your own collection items');
    }
    
    await CollectionItems.updateAsync(itemId, {
      $set: {
        favorite: !item.favorite,
        updatedAt: new Date()
      }
    });
    
    return !item.favorite;
  },
  
  async 'collection.setStatus'(itemId, status) {
    check(itemId, String);
    check(status, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    checkRateLimit(this.userId, 'collection.setStatus');
    validateStatus(status);
    
    const item = await CollectionItems.findOneAsync(itemId);
    if (!item) {
      throw new Meteor.Error('item-not-found', 'Collection item not found');
    }
    
    if (item.userId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only update your own collection items');
    }
    
    const updateFields = {
      status: status,
      updatedAt: new Date()
    };
    
    // Auto-set dateCompleted when marking as completed
    if (status === 'completed' && !item.dateCompleted) {
      updateFields.dateCompleted = new Date();
    }
    
    await CollectionItems.updateAsync(itemId, { $set: updateFields });
    
    return true;
  },
  
  async 'collection.getStats'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    checkRateLimit(this.userId, 'collection.getStats');
    
    const items = await CollectionItems.find({ userId: this.userId }).fetchAsync();
    
    const stats = {
      total: items.length,
      byStatus: {
        backlog: 0,
        playing: 0,
        completed: 0,
        abandoned: 0,
        wishlist: 0
      },
      favorites: 0,
      totalHoursPlayed: 0,
      averageRating: null,
      platformCounts: {},
      storefrontCounts: {},
      recentlyAdded: [],
      recentlyCompleted: []
    };
    
    let ratingSum = 0;
    let ratingCount = 0;
    
    for (const item of items) {
      if (stats.byStatus[item.status] !== undefined) {
        stats.byStatus[item.status]++;
      }
      
      if (item.favorite) {
        stats.favorites++;
      }
      
      if (item.hoursPlayed) {
        stats.totalHoursPlayed += item.hoursPlayed;
      }
      
      if (item.rating) {
        ratingSum += item.rating;
        ratingCount++;
      }
      
      // Count platforms (support both old and new format)
      const platforms = item.platforms || (item.platform ? [item.platform] : []);
      for (const platform of platforms) {
        stats.platformCounts[platform] = (stats.platformCounts[platform] || 0) + 1;
      }
      
      // Count storefronts
      for (const storefront of (item.storefronts || [])) {
        stats.storefrontCounts[storefront] = (stats.storefrontCounts[storefront] || 0) + 1;
      }
    }
    
    if (ratingCount > 0) {
      stats.averageRating = Math.round((ratingSum / ratingCount) * 10) / 10;
    }
    
    const recentlyAdded = await CollectionItems.find(
      { userId: this.userId },
      { sort: { dateAdded: -1 }, limit: 5 }
    ).fetchAsync();
    stats.recentlyAdded = recentlyAdded.map(item => item._id);
    
    const recentlyCompleted = await CollectionItems.find(
      { userId: this.userId, status: 'completed', dateCompleted: { $ne: null } },
      { sort: { dateCompleted: -1 }, limit: 5 }
    ).fetchAsync();
    stats.recentlyCompleted = recentlyCompleted.map(item => item._id);
    
    return stats;
  },
  
  async 'games.search'(query, options = {}) {
    check(query, String);
    check(options, {
      limit: Match.Maybe(Number),
      platform: Match.Maybe(String),
      genre: Match.Maybe(String)
    });
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    checkRateLimit(this.userId, 'games.search');
    
    const limit = Math.min(options.limit || 20, 100);
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
    
    const games = await Games.find(searchQuery, {
      limit: limit,
      sort: { title: 1, name: 1 }
    }).fetchAsync();
    
    return games;
  },

  async 'user.getSubscriptionStatus'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) {
      throw new Meteor.Error('not-found', 'User not found');
    }
    
    return {
      subscriptions: user.subscriptions || [],
      hubUserId: user.services?.sso?.hubUserId
    };
  },
  
  async 'user.hasAccess'(requiredProductIds) {
    check(requiredProductIds, Match.Optional([String]));
    
    if (!this.userId) {
      return false;
    }
    
    const products = requiredProductIds || Meteor.settings.public?.requiredProducts || [];
    
    if (products.length === 0) {
      return true;
    }
    
    return await checkSubscription(this.userId, products);
  }
});
