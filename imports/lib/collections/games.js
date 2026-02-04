import { Mongo } from 'meteor/mongo';

export const Games = new Mongo.Collection('games');

// Schema documentation:
// {
//   _id: String,              // MongoDB ID
//   igdbId: Number,           // IGDB game ID (for syncing) - null for custom games
//   ownerId: String,          // null = IGDB game (public), set = custom game (private to owner)
//   title: String,            // Game title (primary display name)
//   slug: String,             // URL-friendly slug
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
//   coverImageId: String,     // IGDB image_id for cover
//   igdbCoverUrl: String,     // Fallback IGDB CDN URL
//   localCoverId: String,     // ostrio:files ID for downloaded/uploaded cover
//   localCoverUrl: String,    // Local cover URL (after processing)
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
