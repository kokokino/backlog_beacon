import { Meteor } from 'meteor/meteor';

// Storefront definitions for tracking where games were purchased
// These are loaded from settings but we provide defaults here

export const DEFAULT_STOREFRONTS = [
  // PC-Focused Storefronts
  { id: 'steam', name: 'Steam', category: 'pc' },
  { id: 'gog', name: 'GOG', category: 'pc' },
  { id: 'epic', name: 'Epic Games Store', category: 'pc' },
  { id: 'itch', name: 'itch.io', category: 'pc' },
  { id: 'humble', name: 'Humble Store', category: 'pc' },
  { id: 'gmg', name: 'Green Man Gaming', category: 'pc' },
  { id: 'fanatical', name: 'Fanatical', category: 'pc' },
  { id: 'origin', name: 'Origin (EA)', category: 'pc' },
  { id: 'ubisoft', name: 'Ubisoft Connect', category: 'pc' },
  { id: 'battlenet', name: 'Battle.net', category: 'pc' },
  { id: 'microsoft', name: 'Microsoft Store', category: 'pc' },
  { id: 'amazon', name: 'Amazon Games', category: 'pc' },
  { id: 'luna', name: 'Luna', category: 'pc' },
  
  // Console and Cross-Platform Storefronts
  { id: 'playstation', name: 'PlayStation Store', category: 'console' },
  { id: 'xbox', name: 'Xbox Store', category: 'console' },
  { id: 'nintendo', name: 'Nintendo eShop', category: 'console' },
  
  // Virtual Reality
  { id: 'oculus', name: 'Oculus Store', category: 'vr' },
  { id: 'meta', name: 'Meta Store', category: 'vr' },
  
  // Mobile
  { id: 'google', name: 'Google Play Store', category: 'mobile' },
  { id: 'apple', name: 'Apple App Store', category: 'mobile' },
  
  // Other
  { id: 'physical', name: 'Physical Copy', category: 'other' },
  { id: 'other', name: 'Other', category: 'other' }
];

export const STOREFRONT_CATEGORIES = [
  { id: 'pc', name: 'PC' },
  { id: 'console', name: 'Console' },
  { id: 'vr', name: 'VR' },
  { id: 'mobile', name: 'Mobile' },
  { id: 'other', name: 'Other' }
];

// Helper to get storefronts from settings or use defaults
export function getStorefronts() {
  if (typeof Meteor !== 'undefined' && Meteor.settings?.public?.storefronts) {
    return Meteor.settings.public.storefronts;
  }
  return DEFAULT_STOREFRONTS;
}

// Helper to find storefront by ID
export function getStorefrontById(id) {
  const storefronts = getStorefronts();
  return storefronts.find(storefront => storefront.id === id);
}

// Helper to find storefront by name (case-insensitive, partial match)
export function findStorefrontByName(name) {
  if (!name) {
    return null;
  }
  const storefronts = getStorefronts();
  const normalizedName = name.toLowerCase().trim();
  
  // Try exact match first
  let found = storefronts.find(storefront => 
    storefront.name.toLowerCase() === normalizedName
  );
  
  if (found) {
    return found;
  }
  
  // Try partial match
  found = storefronts.find(storefront => 
    storefront.name.toLowerCase().includes(normalizedName) ||
    normalizedName.includes(storefront.name.toLowerCase())
  );
  
  if (found) {
    return found;
  }
  
  // Try matching common variations
  const variations = {
    'epic games': 'epic',
    'epic games store': 'epic',
    'epic': 'epic',
    'uplay': 'ubisoft',
    'ubisoft connect / uplay': 'ubisoft',
    'ubisoft connect': 'ubisoft',
    'origin': 'origin',
    'ea': 'origin',
    'ea app': 'origin',
    'blizzard': 'battlenet',
    'battle.net': 'battlenet',
    'bnet': 'battlenet',
    'microsoft store': 'microsoft',
    'windows store': 'microsoft',
    'xbox store': 'xbox',
    'playstation network': 'playstation',
    'psn': 'playstation',
    'ps store': 'playstation',
    'playstation store': 'playstation',
    'xbox live': 'xbox',
    'nintendo eshop': 'nintendo',
    'eshop': 'nintendo',
    'oculus': 'oculus',
    'oculus store': 'oculus',
    'meta quest': 'meta',
    'quest': 'meta',
    'meta store': 'meta',
    'google play': 'google',
    'play store': 'google',
    'google play store': 'google',
    'app store': 'apple',
    'apple app store': 'apple',
    'ios': 'apple',
    'physical': 'physical',
    'retail': 'physical',
    'disc': 'physical',
    'box': 'physical',
    'legacy games': 'other',
    'legacygames': 'other',
    'other': 'other',
    'n/a': 'other'
  };
  
  const variationKey = Object.keys(variations).find(key => 
    normalizedName.includes(key) || key.includes(normalizedName)
  );
  
  if (variationKey) {
    return storefronts.find(storefront => storefront.id === variations[variationKey]);
  }
  
  return null;
}

// Helper to get storefronts grouped by category
export function getStorefrontsByCategory() {
  const storefronts = getStorefronts();
  const grouped = {};
  
  for (const category of STOREFRONT_CATEGORIES) {
    grouped[category.id] = {
      name: category.name,
      storefronts: storefronts.filter(storefront => storefront.category === category.id)
    };
  }
  
  return grouped;
}

// Helper to get storefront names from IDs
export function getStorefrontNames(storefrontIds) {
  if (!storefrontIds || storefrontIds.length === 0) {
    return [];
  }
  
  return storefrontIds
    .map(id => {
      const storefront = getStorefrontById(id);
      return storefront ? storefront.name : id;
    })
    .filter(Boolean);
}

// Get valid storefront IDs
export function getValidStorefrontIds() {
  return getStorefronts().map(s => s.id);
}
