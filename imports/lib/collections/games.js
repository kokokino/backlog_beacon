import { Mongo } from 'meteor/mongo';

export const Games = new Mongo.Collection('games');

// Schema documentation:
// {
//   _id: String,              // MongoDB ID
//   igdbId: Number,           // IGDB game ID (for syncing)
//   title: String,            // Game title
//   slug: String,             // URL-friendly slug
//   platforms: [String],      // Array of platform names
//   releaseYear: Number,      // Year of first release
//   releaseDate: Date,        // Full release date if known
//   developer: String,        // Primary developer
//   publisher: String,        // Primary publisher
//   genres: [String],         // Array of genre names
//   summary: String,          // Game description
//   coverImageId: String,     // Local file ID (ostrio:files)
//   igdbCoverUrl: String,     // Fallback IGDB CDN URL
//   igdbUpdatedAt: Number,    // IGDB updated_at timestamp
//   igdbChecksum: String,     // IGDB checksum for change detection
//   createdAt: Date,          // When added to our database
//   updatedAt: Date           // Last local update
// }

// Indexes are created in server/main.js
