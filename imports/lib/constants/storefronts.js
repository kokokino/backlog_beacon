import { Meteor } from 'meteor/meteor';
import { Storefronts, STOREFRONT_CATEGORIES } from '../collections/storefronts.js';

// Re-export categories
export { STOREFRONT_CATEGORIES };

// Default storefronts for fallback when DB is not available (client-side before subscription ready)
export const DEFAULT_STOREFRONTS = [
  { storefrontId: 'steam', name: 'Steam', category: 'pc' },
  { storefrontId: 'gog', name: 'GOG', category: 'pc' },
  { storefrontId: 'epic', name: 'Epic Games Store', category: 'pc' },
  { storefrontId: 'itch', name: 'itch.io', category: 'pc' },
  { storefrontId: 'humble', name: 'Humble Store', category: 'pc' },
  { storefrontId: 'gmg', name: 'Green Man Gaming', category: 'pc' },
  { storefrontId: 'fanatical', name: 'Fanatical', category: 'pc' },
  { storefrontId: 'origin', name: 'Origin (EA)', category: 'pc' },
  { storefrontId: 'ubisoft', name: 'Ubisoft Connect', category: 'pc' },
  { storefrontId: 'battlenet', name: 'Battle.net', category: 'pc' },
  { storefrontId: 'legacygames', name: 'Legacy Games', category: 'pc' },
  { storefrontId: 'microsoft', name: 'Microsoft Store', category: 'pc' },
  { storefrontId: 'amazon', name: 'Amazon Games', category: 'pc' },
  { storefrontId: 'luna', name: 'Luna', category: 'pc' },
  { storefrontId: 'playstation', name: 'PlayStation Store', category: 'console' },
  { storefrontId: 'xbox', name: 'Xbox Store', category: 'console' },
  { storefrontId: 'nintendo', name: 'Nintendo eShop', category: 'console' },
  { storefrontId: 'oculus', name: 'Oculus Store', category: 'vr' },
  { storefrontId: 'meta', name: 'Meta Store', category: 'vr' },
  { storefrontId: 'google', name: 'Google Play Store', category: 'mobile' },
  { storefrontId: 'apple', name: 'Apple App Store', category: 'mobile' },
  { storefrontId: 'physical', name: 'Physical Copy', category: 'other' },
  { storefrontId: 'other', name: 'Other', category: 'other' }
];

// Cache for storefronts loaded from DB
let storefrontsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

// Helper to get storefronts from DB or fallback to defaults
export function getStorefronts() {
  // On server, always query DB
  if (Meteor.isServer) {
    const storefronts = Storefronts.find(
      { isActive: true },
      { sort: { sortOrder: 1 } }
    ).fetch();
    
    if (storefronts.length > 0) {
      // Map to expected format for backward compatibility
      return storefronts.map(s => ({
        id: s.storefrontId,
        name: s.name,
        category: s.category,
        aliases: s.aliases || []
      }));
    }
    return DEFAULT_STOREFRONTS.map(s => ({
      id: s.storefrontId,
      name: s.name,
      category: s.category,
      aliases: []
    }));
  }
  
  // On client, use cache or defaults
  const now = Date.now();
  if (storefrontsCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return storefrontsCache;
  }
  
  // Try to get from minimongo (if subscribed)
  const storefronts = Storefronts.find(
    { isActive: true },
    { sort: { sortOrder: 1 } }
  ).fetch();
  
  if (storefronts.length > 0) {
    storefrontsCache = storefronts.map(s => ({
      id: s.storefrontId,
      name: s.name,
      category: s.category,
      aliases: s.aliases || []
    }));
    cacheTimestamp = now;
    return storefrontsCache;
  }
  
  // Fallback to defaults
  return DEFAULT_STOREFRONTS.map(s => ({
    id: s.storefrontId,
    name: s.name,
    category: s.category,
    aliases: []
  }));
}

// Clear cache (call when storefronts subscription updates)
export function clearStorefrontsCache() {
  storefrontsCache = null;
  cacheTimestamp = 0;
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
  
  // Try alias match
  found = storefronts.find(storefront =>
    storefront.aliases?.some(alias => alias.toLowerCase() === normalizedName)
  );
  
  if (found) {
    return found;
  }
  
  // Try partial match on name
  found = storefronts.find(storefront => 
    storefront.name.toLowerCase().includes(normalizedName) ||
    normalizedName.includes(storefront.name.toLowerCase())
  );
  
  if (found) {
    return found;
  }
  
  // Try matching common variations (hardcoded for import compatibility)
  const variations = {
    'epic games': 'epic',
    'epic games store': 'epic',
    'uplay': 'ubisoft',
    'ubisoft connect / uplay': 'ubisoft',
    'ubisoft connect': 'ubisoft',
    'ea': 'origin',
    'ea app': 'origin',
    'blizzard': 'battlenet',
    'battle.net': 'battlenet',
    'bnet': 'battlenet',
    'windows store': 'microsoft',
    'xbox store': 'xbox',
    'playstation network': 'playstation',
    'psn': 'playstation',
    'ps store': 'playstation',
    'xbox live': 'xbox',
    'nintendo eshop': 'nintendo',
    'eshop': 'nintendo',
    'oculus store': 'oculus',
    'meta quest': 'meta',
    'quest': 'meta',
    'google play': 'google',
    'play store': 'google',
    'app store': 'apple',
    'ios': 'apple',
    'retail': 'physical',
    'disc': 'physical',
    'box': 'physical',
    'legacy games': 'legacygames',
    'legacygames': 'legacygames',
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
    grouped[category.categoryId] = {
      name: category.name,
      storefronts: storefronts.filter(storefront => storefront.category === category.categoryId)
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
