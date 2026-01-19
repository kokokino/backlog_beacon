import { Meteor } from 'meteor/meteor';
import { FilesCollection } from 'meteor/ostrio:files';
import path from 'path';
import fs from 'fs';

// Determine storage path
const storagePath = process.env.COVERS_STORAGE_PATH || 
  (Meteor.isDevelopment 
    ? path.join(process.cwd(), '.covers')
    : '/app/covers');

// Ensure directory exists
if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
  console.log('GameCovers: Created storage directory:', storagePath);
}

export const GameCovers = new FilesCollection({
  collectionName: 'gameCovers',
  storagePath: storagePath,
  allowClientCode: false,
  
  onBeforeUpload(file) {
    // Only allow WebP images
    if (file.extension !== 'webp') {
      return 'Only WebP images are allowed';
    }
    
    // Limit file size to 500KB
    if (file.size > 512000) {
      return 'File too large (max 500KB)';
    }
    
    return true;
  },
  
  downloadCallback(fileObj) {
    // Allow all downloads for cover images
    return true;
  }
});

// Publish covers for games the user is viewing
if (Meteor.isServer) {
  Meteor.publish('gameCovers', function(gameIds) {
    if (!this.userId) {
      return this.ready();
    }
    
    if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) {
      return this.ready();
    }
    
    // Limit to prevent abuse
    const limitedIds = gameIds.slice(0, 100);
    
    return GameCovers.find({
      'meta.gameId': { $in: limitedIds }
    }).cursor;
  });
}
