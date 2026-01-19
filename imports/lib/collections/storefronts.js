import { Mongo } from 'meteor/mongo';

export const Storefronts = new Mongo.Collection('storefronts');

// Schema documentation:
// {
//   _id: String,              // MongoDB ID
//   storefrontId: String,     // Unique identifier (e.g., 'steam', 'gog')
//   name: String,             // Display name (e.g., 'Steam', 'GOG')
//   category: String,         // Category ID ('pc', 'console', 'vr', 'mobile', 'other')
//   sortOrder: Number,        // For ordering in UI
//   aliases: [String],        // Alternative names for matching during import
//   isActive: Boolean,        // Whether to show in UI
//   createdAt: Date,
//   updatedAt: Date
// }

export const STOREFRONT_CATEGORIES = [
  { categoryId: 'pc', name: 'PC', sortOrder: 0 },
  { categoryId: 'console', name: 'Console', sortOrder: 1 },
  { categoryId: 'vr', name: 'VR', sortOrder: 2 },
  { categoryId: 'mobile', name: 'Mobile', sortOrder: 3 },
  { categoryId: 'other', name: 'Other', sortOrder: 4 }
];

// Indexes are created in migrations
