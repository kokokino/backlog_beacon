import { Mongo } from 'meteor/mongo';

export const CollectionItems = new Mongo.Collection('collectionItems');

// Schema documentation:
// {
//   _id: String,              // MongoDB ID
//   userId: String,           // Meteor user ID (owner)
//   gameId: String,           // Reference to Games collection (source of truth)
//   igdbId: Number,           // IGDB game ID (denormalized for queries)
//   game: {                   // Denormalized game data for fast queries (no $lookup)
//     title: String,          // Game title (for display and sorting)
//     releaseYear: Number,    // Year of first release
//     ownerId: String,        // null = IGDB game, set = custom game (privacy)
//     genres: [String],       // Array of genre names
//     localCoverUrl: String,  // Local WebP cover (highest priority)
//     coverImageId: String,   // IGDB image_id to construct URL
//     igdbCoverUrl: String    // Pre-built IGDB CDN URL
//   },
//   platforms: [String],      // All platforms user owns it on
//   storefronts: [String],    // Storefront IDs where purchased (steam, gog, epic, etc.)
//   status: String,           // 'backlog', 'playing', 'completed', 'abandoned', 'wishlist'
//   rating: Number,           // 1-5 stars (optional)
//   hoursPlayed: Number,      // Estimated hours (optional)
//   notes: String,            // User notes (optional)
//   dateAdded: Date,          // When added to collection
//   dateStarted: Date,        // When started playing (optional)
//   dateCompleted: Date,      // When completed (optional)
//   favorite: Boolean,        // Marked as favorite
//   physical: Boolean,        // Physical or digital copy
//   createdAt: Date,          // Record creation timestamp
//   updatedAt: Date           // Last update timestamp
// }

export const COLLECTION_STATUSES = {
  BACKLOG: 'backlog',
  PLAYING: 'playing',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  WISHLIST: 'wishlist'
};

export const STATUS_LABELS = {
  backlog: 'Backlog',
  playing: 'Playing',
  completed: 'Completed',
  abandoned: 'Abandoned',
  wishlist: 'Wishlist'
};

export const STATUS_ICONS = {
  backlog: '📚',
  playing: '🎮',
  completed: '✅',
  abandoned: '🚫',
  wishlist: '⭐'
};

// Indexes are created in server/main.js
