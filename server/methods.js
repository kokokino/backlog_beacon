import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { check, Match } from 'meteor/check';
import { Games } from '../imports/lib/collections/games.js';
import { CollectionItems, COLLECTION_STATUSES } from '../imports/lib/collections/collectionItems.js';
import { checkSubscription } from '../imports/hub/subscriptions.js';
import { getValidStorefrontIds } from '../imports/lib/constants/storefronts.js';
import { checkDistributedRateLimit } from './lib/distributedRateLimit.js';
import { isUsingB2 } from './covers/storageClient.js';
import { deleteFromB2, extractKeyFromB2Url } from './covers/b2Storage.js';
import { GameCovers } from './covers/coversCollection.js';
import { sanitizeSearchQuery } from './igdb/client.js';
import { buildEmbeddedGame } from './lib/gameHelpers.js';

const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 10;

// Delete cover file for a custom game (B2 or local)
async function deleteCustomGameCover(game) {
  if (!game.localCoverUrl && !game.localCoverId) {
    return;
  }

  if (isUsingB2() && game.localCoverUrl) {
    const key = extractKeyFromB2Url(game.localCoverUrl);
    if (key) {
      try {
        await deleteFromB2(key);
      } catch (error) {
        console.error('Error deleting cover from B2:', error);
      }
    }
  } else if (game.localCoverId) {
    try {
      const coverDoc = await GameCovers.findOneAsync(game.localCoverId);
      if (coverDoc) {
        await GameCovers.removeAsync(game.localCoverId);
      }
    } catch (error) {
      console.error('Error deleting local cover:', error);
    }
  }
}

async function checkRateLimit(userId, methodName) {
  const key = `method:${userId}:${methodName}`;
  const result = await checkDistributedRateLimit(key, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);

  if (!result.allowed) {
    throw new Meteor.Error('rate-limited', 'Too many requests. Please slow down.');
  }

  return true;
}

const validStatuses = Object.values(COLLECTION_STATUSES);

export function validateStatus(status) {
  if (!validStatuses.includes(status)) {
    throw new Meteor.Error('invalid-status', `Status must be one of: ${validStatuses.join(', ')}`);
  }
}

export function validateRating(rating) {
  if (rating !== null && rating !== undefined) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Meteor.Error('invalid-rating', 'Rating must be an integer between 1 and 5');
    }
  }
}

export function validateStorefronts(storefronts) {
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
    
    await checkRateLimit(this.userId, 'collection.addItem');
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
      game: buildEmbeddedGame(game),
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
      platforms: Match.Maybe([String]),
      storefronts: Match.Maybe([String])
    });
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    await checkRateLimit(this.userId, 'collection.updateItem');
    
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

    await checkRateLimit(this.userId, 'collection.removeItem');

    const item = await CollectionItems.findOneAsync(itemId);
    if (!item) {
      throw new Meteor.Error('item-not-found', 'Collection item not found');
    }

    if (item.userId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only remove your own collection items');
    }

    const result = await CollectionItems.removeAsync(itemId);

    // If the game is a custom game owned by this user, delete it and its cover
    if (item.gameId) {
      const game = await Games.findOneAsync(item.gameId);
      if (game && game.ownerId === this.userId) {
        // Delete cover file if exists
        await deleteCustomGameCover(game);
        // Delete the game document
        await Games.removeAsync(game._id);
      }
    }

    return result;
  },
  
  async 'collection.toggleFavorite'(itemId) {
    check(itemId, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    await checkRateLimit(this.userId, 'collection.toggleFavorite');
    
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
    
    await checkRateLimit(this.userId, 'collection.setStatus');
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

    await checkRateLimit(this.userId, 'collection.getStats');

    const rawCollection = CollectionItems.rawCollection();

    // Use $facet to compute all stats in a single aggregation pass
    const pipeline = [
      { $match: { userId: this.userId } },
      {
        $facet: {
          // Total count and status counts
          statusCounts: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ],
          // Favorites count
          favorites: [
            { $match: { favorite: true } },
            { $count: 'count' }
          ],
          // Hours and rating totals
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                totalHours: { $sum: { $ifNull: ['$hoursPlayed', 0] } },
                ratingSum: {
                  $sum: {
                    $cond: [{ $gt: ['$rating', 0] }, '$rating', 0]
                  }
                },
                ratingCount: {
                  $sum: {
                    $cond: [{ $gt: ['$rating', 0] }, 1, 0]
                  }
                }
              }
            }
          ],
          // Platform counts
          platformCounts: [
            { $unwind: { path: '$platforms', preserveNullAndEmptyArrays: false } },
            {
              $group: {
                _id: '$platforms',
                count: { $sum: 1 }
              }
            }
          ],
          // Storefront counts
          storefrontCounts: [
            { $unwind: { path: '$storefronts', preserveNullAndEmptyArrays: false } },
            {
              $group: {
                _id: '$storefronts',
                count: { $sum: 1 }
              }
            }
          ],
          // Recently added (top 5)
          recentlyAdded: [
            { $sort: { dateAdded: -1 } },
            { $limit: 5 },
            { $project: { _id: 1 } }
          ],
          // Recently completed (top 5)
          recentlyCompleted: [
            { $match: { status: 'completed', dateCompleted: { $ne: null } } },
            { $sort: { dateCompleted: -1 } },
            { $limit: 5 },
            { $project: { _id: 1 } }
          ]
        }
      }
    ];

    const results = await rawCollection.aggregate(pipeline).toArray();
    const facets = results[0] || {};

    // Transform aggregation results into the expected format
    const stats = {
      total: 0,
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

    // Process totals
    if (facets.totals && facets.totals[0]) {
      const totals = facets.totals[0];
      stats.total = totals.total || 0;
      stats.totalHoursPlayed = totals.totalHours || 0;
      if (totals.ratingCount > 0) {
        stats.averageRating = Math.round((totals.ratingSum / totals.ratingCount) * 10) / 10;
      }
    }

    // Process status counts
    if (facets.statusCounts) {
      for (const item of facets.statusCounts) {
        if (stats.byStatus[item._id] !== undefined) {
          stats.byStatus[item._id] = item.count;
        }
      }
    }

    // Process favorites
    if (facets.favorites && facets.favorites[0]) {
      stats.favorites = facets.favorites[0].count;
    }

    // Process platform counts
    if (facets.platformCounts) {
      for (const item of facets.platformCounts) {
        if (item._id) {
          stats.platformCounts[item._id] = item.count;
        }
      }
    }

    // Process storefront counts
    if (facets.storefrontCounts) {
      for (const item of facets.storefrontCounts) {
        if (item._id) {
          stats.storefrontCounts[item._id] = item.count;
        }
      }
    }

    // Process recently added
    if (facets.recentlyAdded) {
      stats.recentlyAdded = facets.recentlyAdded.map(item => item._id);
    }

    // Process recently completed
    if (facets.recentlyCompleted) {
      stats.recentlyCompleted = facets.recentlyCompleted.map(item => item._id);
    }

    return stats;
  },

  async 'collection.getCount'(filters = {}) {
    check(filters, {
      status: Match.Maybe(String),
      platform: Match.Maybe(String),
      storefront: Match.Maybe(String),
      favorite: Match.Maybe(Boolean),
      search: Match.Maybe(String)
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    await checkRateLimit(this.userId, 'collection.getCount');

    // Build query using embedded game data (no $lookup needed)
    const query = { userId: this.userId };

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.platform) {
      query.platforms = filters.platform;
    }

    if (filters.storefront) {
      query.storefronts = filters.storefront;
    }

    if (filters.favorite === true) {
      query.favorite = true;
    }

    // Search uses embedded game.title (no $lookup needed)
    if (filters.search && filters.search.trim().length > 0) {
      query['game.title'] = { $regex: filters.search.trim(), $options: 'i' };
    }

    const count = await CollectionItems.countDocuments(query);
    return count;
  },

  async 'collection.getItemsChunk'(options = {}) {
    check(options, {
      sort: Match.Maybe(String),
      limit: Match.Maybe(Number),
      skip: Match.Maybe(Number),
      status: Match.Maybe(String),
      platform: Match.Maybe(String),
      favorite: Match.Maybe(Boolean),
      search: Match.Maybe(String)
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    await checkRateLimit(this.userId, 'collection.getItemsChunk');

    const sortValue = options.sort || 'name-asc';
    const isNameSort = sortValue.startsWith('name');
    const sortDirection = sortValue.endsWith('desc') ? -1 : 1;
    const limit = Math.min(options.limit || 100, 200);
    const skip = options.skip || 0;

    // Build match stage using embedded game data (no $lookup needed)
    const matchStage = { userId: this.userId };

    if (options.status) {
      matchStage.status = options.status;
    }

    if (options.platform) {
      matchStage.platforms = options.platform;
    }

    if (options.favorite === true) {
      matchStage.favorite = true;
    }

    // Filter by embedded game.ownerId for custom game privacy
    matchStage.$or = [
      { 'game.ownerId': { $exists: false } },
      { 'game.ownerId': null },
      { 'game.ownerId': this.userId }
    ];

    // Search uses embedded game.title
    const searchTerm = options.search && options.search.trim().length > 0 ? options.search.trim() : null;
    if (searchTerm) {
      matchStage['game.title'] = { $regex: searchTerm, $options: 'i' };
    }

    // Build aggregation pipeline (no $lookup - uses denormalized game data)
    const pipeline = [
      { $match: matchStage }
    ];

    // Add sort field and sort
    if (isNameSort) {
      pipeline.push({
        $addFields: {
          sortTitle: { $toLower: { $ifNull: ['$game.title', ''] } }
        }
      });
      pipeline.push({ $sort: { sortTitle: sortDirection } });
    } else {
      pipeline.push({ $sort: { dateAdded: sortDirection } });
    }

    // Pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    // Remove temporary sort field from results
    pipeline.push({
      $project: {
        sortTitle: 0
      }
    });

    const rawCollection = CollectionItems.rawCollection();
    const items = await rawCollection.aggregate(pipeline).toArray();

    // Each item has game embedded as item.game (denormalized)
    return items;
  },

  async 'games.count'(filters = {}) {
    check(filters, {
      search: Match.Maybe(String),
      platform: Match.Maybe(String),
      genre: Match.Maybe(String)
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    await checkRateLimit(this.userId, 'games.count');

    const query = {
      $or: [
        { ownerId: { $exists: false } },
        { ownerId: null },
        { ownerId: this.userId }
      ]
    };

    if (filters.search && filters.search.trim().length > 0) {
      const searchTerm = filters.search.trim();
      query.title = { $regex: searchTerm, $options: 'i' };
    }

    if (filters.platform) {
      query.platforms = filters.platform;
    }

    if (filters.genre) {
      query.genres = filters.genre;
    }

    const count = await Games.countDocuments(query);
    return count;
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

    await checkRateLimit(this.userId, 'games.search');

    const limit = Math.min(options.limit || 20, 100);
    const searchQuery = {
      $or: [
        { ownerId: { $exists: false } },
        { ownerId: null },
        { ownerId: this.userId }
      ]
    };

    if (query && query.trim()) {
      const searchTerm = sanitizeSearchQuery(query.trim());
      searchQuery.title = { $regex: searchTerm, $options: 'i' };
    }

    if (options.platform) {
      searchQuery.platforms = options.platform;
    }

    if (options.genre) {
      searchQuery.genres = options.genre;
    }

    const games = await Games.find(searchQuery, {
      limit: limit,
      sort: { title: 1 }
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
  
  async 'user.hasAccess'(requiredProductSlugs) {
    check(requiredProductSlugs, Match.Optional([String]));

    if (!this.userId) {
      return false;
    }

    const products = requiredProductSlugs || Meteor.settings.public?.requiredProducts || [];

    if (products.length === 0) {
      return true;
    }

    return await checkSubscription(this.userId, products);
  },

  async 'collection.getGameIds'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const items = await CollectionItems.find(
      { userId: this.userId, gameId: { $exists: true, $ne: null } },
      { fields: { gameId: 1 } }
    ).fetchAsync();

    return items.map(item => item.gameId);
  }
});
