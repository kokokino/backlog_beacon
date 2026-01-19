import { Mongo } from 'meteor/mongo';

export const CollectionItems = new Mongo.Collection('collectionItems');

// Schema documentation:
// {
//   _id: String,              // MongoDB ID
//   userId: String,           // Meteor user ID (owner)
//   gameId: String,           // Reference to Games collection
//   platform: String,         // Specific platform for this copy
//   status: String,           // 'backlog', 'playing', 'completed', 'abandoned'
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
  ABANDONED: 'abandoned'
};

export const STATUS_LABELS = {
  backlog: 'Backlog',
  playing: 'Playing',
  completed: 'Completed',
  abandoned: 'Abandoned'
};

// Indexes are created in server/main.js
