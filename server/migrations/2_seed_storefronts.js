console.log('=== LOADING MIGRATION 2_seed_storefronts.js ===');

import { Migrations } from 'meteor/quave:migrations';
import { Storefronts } from '../../imports/lib/collections/storefronts.js';

const DEFAULT_STOREFRONTS = [
  // PC-Focused Storefronts
  { storefrontId: 'steam', name: 'Steam', category: 'pc', sortOrder: 0 },
  { storefrontId: 'gog', name: 'GOG', category: 'pc', sortOrder: 1 },
  { storefrontId: 'epic', name: 'Epic Games Store', category: 'pc', sortOrder: 2 },
  { storefrontId: 'itch', name: 'itch.io', category: 'pc', sortOrder: 3 },
  { storefrontId: 'humble', name: 'Humble Store', category: 'pc', sortOrder: 4 },
  { storefrontId: 'gmg', name: 'Green Man Gaming', category: 'pc', sortOrder: 5 },
  { storefrontId: 'fanatical', name: 'Fanatical', category: 'pc', sortOrder: 6 },
  { storefrontId: 'origin', name: 'Origin (EA)', category: 'pc', sortOrder: 7 },
  { storefrontId: 'ubisoft', name: 'Ubisoft Connect', category: 'pc', sortOrder: 8 },
  { storefrontId: 'battlenet', name: 'Battle.net', category: 'pc', sortOrder: 9 },
  { storefrontId: 'microsoft', name: 'Microsoft Store', category: 'pc', sortOrder: 10 },
  { storefrontId: 'amazon', name: 'Amazon Games', category: 'pc', sortOrder: 11 },
  { storefrontId: 'luna', name: 'Luna', category: 'pc', sortOrder: 12 },
  
  // Console and Cross-Platform Storefronts
  { storefrontId: 'playstation', name: 'PlayStation Store', category: 'console', sortOrder: 20 },
  { storefrontId: 'xbox', name: 'Xbox Store', category: 'console', sortOrder: 21 },
  { storefrontId: 'nintendo', name: 'Nintendo eShop', category: 'console', sortOrder: 22 },
  
  // Virtual Reality
  { storefrontId: 'oculus', name: 'Oculus Store', category: 'vr', sortOrder: 30 },
  { storefrontId: 'meta', name: 'Meta Store', category: 'vr', sortOrder: 31 },
  
  // Mobile
  { storefrontId: 'google', name: 'Google Play Store', category: 'mobile', sortOrder: 40 },
  { storefrontId: 'apple', name: 'Apple App Store', category: 'mobile', sortOrder: 41 },
  
  // Other
  { storefrontId: 'physical', name: 'Physical Copy', category: 'other', sortOrder: 50 },
  { storefrontId: 'other', name: 'Other', category: 'other', sortOrder: 51 }
];

const STOREFRONT_CATEGORIES = [
  { categoryId: 'pc', name: 'PC', sortOrder: 0 },
  { categoryId: 'console', name: 'Console', sortOrder: 1 },
  { categoryId: 'vr', name: 'VR', sortOrder: 2 },
  { categoryId: 'mobile', name: 'Mobile', sortOrder: 3 },
  { categoryId: 'other', name: 'Other', sortOrder: 4 }
];

Migrations.add({
  version: 2,
  name: 'Seed storefronts collection',
  up: async function() {
    console.log('=== RUNNING MIGRATION 2: Seed storefronts ===');
    
    // Check if storefronts already exist
    const existingCount = await Storefronts.find().countAsync();
    if (existingCount > 0) {
      console.log(`Storefronts already seeded (${existingCount} found), skipping`);
      return;
    }
    
    const now = new Date();
    let insertedCount = 0;
    
    for (const storefront of DEFAULT_STOREFRONTS) {
      await Storefronts.insertAsync({
        ...storefront,
        aliases: [],
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
      insertedCount++;
    }
    
    console.log(`✓ Inserted ${insertedCount} storefronts`);
    
    // Create indexes for Storefronts collection
    try {
      await Storefronts.createIndexAsync({ storefrontId: 1 }, { unique: true });
      console.log('✓ Created Storefronts.storefrontId index');
    } catch (error) {
      console.log('Storefronts.storefrontId index may already exist:', error.message);
    }
    
    try {
      await Storefronts.createIndexAsync({ category: 1 });
      console.log('✓ Created Storefronts.category index');
    } catch (error) {
      console.log('Storefronts.category index may already exist:', error.message);
    }
    
    try {
      await Storefronts.createIndexAsync({ sortOrder: 1 });
      console.log('✓ Created Storefronts.sortOrder index');
    } catch (error) {
      console.log('Storefronts.sortOrder index may already exist:', error.message);
    }
    
    try {
      await Storefronts.createIndexAsync({ isActive: 1 });
      console.log('✓ Created Storefronts.isActive index');
    } catch (error) {
      console.log('Storefronts.isActive index may already exist:', error.message);
    }
    
    console.log('✓ Migration 2 completed successfully');
  },
  down: async function() {
    console.log('Rolling back migration 2 - removing storefronts');
    await Storefronts.removeAsync({});
    console.log('✓ Removed all storefronts');
  }
});
