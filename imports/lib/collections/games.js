import { Mongo } from 'meteor/mongo';

export const Games = new Mongo.Collection('games');

// Schema documentation:
// {
//   _id: String,              // MongoDB ID
//   igdbId: Number,           // IGDB game ID (for syncing)
//   title: String,            // Game title (primary display name)
//   name: String,             // Game name (alias for compatibility)
//   slug: String,             // URL-friendly slug
//   searchName: String,       // Lowercase name for searching
//   platforms: [String],      // Array of platform names
//   platformIds: [Number],    // IGDB platform IDs
//   releaseYear: Number,      // Year of first release
//   releaseDate: Date,        // Full release date if known
//   developer: String,        // Primary developer
//   developerIds: [Number],   // IGDB company IDs
//   publisher: String,        // Primary publisher
//   publisherIds: [Number],   // IGDB company IDs
//   genres: [String],         // Array of genre names
//   genreIds: [Number],       // IGDB genre IDs
//   themes: [String],         // Array of theme names
//   summary: String,          // Game description
//   storyline: String,        // Story description
//   coverImageId: String,     // Local file ID (ostrio:files) or IGDB image_id
//   coverUrl: String,         // Local cover URL (after processing)
//   igdbCoverUrl: String,     // Fallback IGDB CDN URL
//   rating: Number,           // IGDB rating (0-100)
//   ratingCount: Number,      // Number of ratings
//   aggregatedRating: Number, // Critic rating (0-100)
//   aggregatedRatingCount: Number,
//   igdbUpdatedAt: Number,    // IGDB updated_at timestamp
//   igdbChecksum: String,     // IGDB checksum for change detection
//   createdAt: Date,          // When added to our database
//   updatedAt: Date           // Last local update
// }

// Indexes are created in server/main.js
