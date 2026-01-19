import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { GameCovers } from './coversCollection.js';
import { 
  getNextQueueItem, 
  markQueueItemCompleted, 
  markQueueItemFailed,
  getQueueStats,
  queueCoverDownload
} from './coverQueue.js';
import { Games } from '../../imports/lib/collections/games.js';
import { getCoverUrl } from '../igdb/client.js';

// Processing state
let isProcessing = false;
let processingInterval = null;
const PROCESS_INTERVAL_MS = 2000;
const IGDB_REQUEST_DELAY_MS = 300;

// Convert image buffer to WebP
async function convertToWebP(imageBuffer) {
  const webpBuffer = await sharp(imageBuffer)
    .webp({
      quality: 75,
      effort: 6
    })
    .toBuffer();
  
  return webpBuffer;
}

// Download image from IGDB
async function downloadIgdbCover(igdbImageId) {
  const url = getCoverUrl(igdbImageId, 'cover_big');
  
  if (!url) {
    throw new Error('Invalid IGDB image ID');
  }
  
  console.log(`CoverProcessor: Downloading from ${url}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download cover: ${response.status} ${response.statusText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Get the storage path from FilesCollection (it's a function, not a property)
function getStoragePath() {
  if (typeof GameCovers.storagePath === 'function') {
    return GameCovers.storagePath();
  }
  return GameCovers.storagePath;
}

// Process a single queue item
async function processQueueItem(item) {
  console.log(`CoverProcessor: Processing game ${item.gameId}, image ${item.igdbImageId}`);
  
  // Download from IGDB
  const imageBuffer = await downloadIgdbCover(item.igdbImageId);
  console.log(`CoverProcessor: Downloaded ${imageBuffer.length} bytes`);
  
  // Convert to WebP
  const webpBuffer = await convertToWebP(imageBuffer);
  console.log(`CoverProcessor: Converted to WebP, ${webpBuffer.length} bytes`);
  
  // Save file to disk manually and then add to FilesCollection
  const fileName = `${item.igdbImageId}.webp`;
  const storagePath = getStoragePath();
  
  // Create a unique file ID
  const fileId = Random.id();
  const filePath = path.join(storagePath, fileId);
  
  // Ensure directory exists
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }
  
  // Write file to disk
  fs.writeFileSync(filePath, webpBuffer);
  console.log(`CoverProcessor: Wrote file to ${filePath}`);
  
  // Get file stats
  const stats = fs.statSync(filePath);
  
  // Insert file record into collection
  const fileDoc = {
    _id: fileId,
    name: fileName,
    type: 'image/webp',
    size: stats.size,
    path: filePath,
    isVideo: false,
    isAudio: false,
    isImage: true,
    isText: false,
    isJSON: false,
    isPDF: false,
    extension: 'webp',
    extensionWithDot: '.webp',
    mime: 'image/webp',
    'mime-type': 'image/webp',
    _storagePath: storagePath,
    _downloadRoute: '/cdn/storage',
    _collectionName: 'gameCovers',
    public: true,
    meta: {
      gameId: item.gameId,
      igdbImageId: item.igdbImageId,
      processedAt: new Date()
    },
    userId: null,
    updatedAt: new Date(),
    versions: {
      original: {
        path: filePath,
        size: stats.size,
        type: 'image/webp',
        extension: 'webp',
        meta: {}
      }
    }
  };
  
  await GameCovers.collection.insertAsync(fileDoc);
  console.log(`CoverProcessor: Inserted file record ${fileId}`);
  
  // Update game document with local cover info
  await Games.updateAsync(item.gameId, {
    $set: {
      localCoverId: fileId,
      localCoverUpdatedAt: new Date()
    }
  });
  
  console.log(`CoverProcessor: Completed game ${item.gameId}, file ${fileId}`);
  
  return fileId;
}

// Main processing loop
async function processQueue() {
  if (isProcessing) {
    return;
  }
  
  isProcessing = true;
  
  try {
    const item = await getNextQueueItem();
    
    if (!item) {
      isProcessing = false;
      return;
    }
    
    console.log(`CoverProcessor: Found queue item for game ${item.gameId}`);
    
    try {
      const coverId = await processQueueItem(item);
      await markQueueItemCompleted(item._id, coverId);
      
      // Small delay to respect IGDB rate limits
      await new Promise(resolve => setTimeout(resolve, IGDB_REQUEST_DELAY_MS));
      
    } catch (error) {
      console.error(`CoverProcessor: Failed to process ${item.gameId}:`, error.message);
      await markQueueItemFailed(item._id, error.message);
    }
    
  } catch (error) {
    console.error('CoverProcessor: Queue processing error:', error);
  }
  
  isProcessing = false;
}

// Queue existing games that need covers
async function queueExistingGamesForCovers() {
  console.log('CoverProcessor: Checking for existing games that need covers...');
  
  try {
    // Find games that have a coverImageId but no localCoverId
    const gamesNeedingCovers = await Games.find({
      coverImageId: { $exists: true, $ne: null },
      $or: [
        { localCoverId: { $exists: false } },
        { localCoverId: null }
      ]
    }, {
      fields: { _id: 1, coverImageId: 1, title: 1 },
      limit: 100 // Process in batches to avoid overwhelming the queue
    }).fetchAsync();
    
    if (gamesNeedingCovers.length === 0) {
      console.log('CoverProcessor: All existing games have local covers (or no cover image)');
      return 0;
    }
    
    console.log(`CoverProcessor: Found ${gamesNeedingCovers.length} games needing covers`);
    
    let queuedCount = 0;
    for (const game of gamesNeedingCovers) {
      try {
        const queueId = await queueCoverDownload(game._id, game.coverImageId, 10); // Lower priority for batch
        if (queueId) {
          queuedCount++;
        }
      } catch (error) {
        console.error(`CoverProcessor: Error queueing cover for game ${game._id}:`, error.message);
      }
    }
    
    console.log(`CoverProcessor: Queued ${queuedCount} games for cover download`);
    return queuedCount;
    
  } catch (error) {
    console.error('CoverProcessor: Error checking existing games:', error);
    return 0;
  }
}

// Start the background processor
export function startCoverProcessor() {
  if (processingInterval) {
    console.log('CoverProcessor: Already running');
    return;
  }
  
  console.log('CoverProcessor: Starting background processor');
  
  // Log initial queue stats and queue existing games
  Meteor.defer(async () => {
    try {
      const stats = await getQueueStats();
      console.log(`CoverProcessor: Initial queue stats - pending: ${stats.pending}, processing: ${stats.processing}, completed: ${stats.completed}, failed: ${stats.failed}`);
      
      // If queue is empty, check for existing games that need covers
      if (stats.pending === 0) {
        await queueExistingGamesForCovers();
        
        // Log updated stats
        const newStats = await getQueueStats();
        console.log(`CoverProcessor: Updated queue stats - pending: ${newStats.pending}, processing: ${newStats.processing}, completed: ${newStats.completed}, failed: ${newStats.failed}`);
      }
    } catch (error) {
      console.error('CoverProcessor: Error during startup:', error);
    }
  });
  
  // Process immediately on start (with small delay to let queue populate)
  Meteor.setTimeout(() => {
    processQueue();
  }, 1000);
  
  // Then process periodically
  processingInterval = Meteor.setInterval(() => {
    processQueue();
  }, PROCESS_INTERVAL_MS);
}

// Stop the background processor
export function stopCoverProcessor() {
  if (processingInterval) {
    Meteor.clearInterval(processingInterval);
    processingInterval = null;
    console.log('CoverProcessor: Stopped background processor');
  }
}

// Check if processor is running
export function isProcessorRunning() {
  return processingInterval !== null;
}

// Export for manual triggering if needed
export { queueExistingGamesForCovers };
