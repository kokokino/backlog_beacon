import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import sharp from 'sharp';
import { GameCovers } from './coversCollection.js';
import {
  claimNextQueueItem,
  markQueueItemCompleted,
  markQueueItemFailed,
  getQueueStats,
  queueCoverDownload,
  cleanupQueue
} from './coverQueue.js';
import { Games } from '../../imports/lib/collections/games.js';
import { getCoverUrl } from '../igdb/client.js';

// Processing state - instanceId ensures each server instance is identifiable
let instanceId = null;
let processingInterval = null;
let cleanupInterval = null;
const PROCESS_INTERVAL_MS = 2000;
const IGDB_REQUEST_DELAY_MS = 300;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  
  // console.log(`CoverProcessor: Downloading from ${url}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download cover: ${response.status} ${response.statusText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Process a single queue item
async function processQueueItem(item) {
  // console.log(`CoverProcessor: Processing game ${item.gameId}, image ${item.igdbImageId}`);
  
  // Download from IGDB
  const imageBuffer = await downloadIgdbCover(item.igdbImageId);
  // console.log(`CoverProcessor: Downloaded ${imageBuffer.length} bytes`);
  
  // Convert to WebP
  const webpBuffer = await convertToWebP(imageBuffer);
  // console.log(`CoverProcessor: Converted to WebP, ${webpBuffer.length} bytes`);
  
  // Use writeAsync to properly add file to FilesCollection
  // This handles file storage, document creation, and URL generation
  const fileName = `${item.igdbImageId}.webp`;
  
  const fileObj = await GameCovers.writeAsync(webpBuffer, {
    fileName: fileName,
    type: 'image/webp',
    meta: {
      gameId: item.gameId,
      igdbImageId: item.igdbImageId,
      processedAt: new Date()
    }
  });
  
  // console.log(`CoverProcessor: Wrote file ${fileObj._id}`);
  
  // Use link() with '/' as URIBase to get a relative URL
  // This ensures the URL works in both development and production
  // Arguments: fileRef, version ('original' is default), URIBase
  const coverUrl = GameCovers.link(fileObj, 'original', '/');
  
  // Update game document with local cover info
  await Games.updateAsync(item.gameId, {
    $set: {
      localCoverId: fileObj._id,
      localCoverUrl: coverUrl,
      localCoverUpdatedAt: new Date()
    }
  });
  
  console.log(`CoverProcessor: Completed game ${item.gameId}, file ${fileObj._id}, url ${coverUrl}`);
  
  return fileObj._id;
}

// Main processing loop - uses atomic claiming to prevent race conditions
async function processQueue() {
  try {
    // Atomic claim - only one instance can get each item
    const item = await claimNextQueueItem(instanceId);

    if (!item) {
      return;
    }

    // console.log(`CoverProcessor: Found queue item for game ${item.gameId}`);

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
    
    // console.log(`CoverProcessor: Queued ${queuedCount} games for cover download`);
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

  // Generate unique instance ID for distributed locking
  instanceId = Random.id();
  console.log(`CoverProcessor: Starting background processor (instance: ${instanceId})`);
  
  // Log initial queue stats, cleanup old items, and queue existing games
  Meteor.defer(async () => {
    try {
      // Clean up old completed/failed items
      const cleanedUp = await cleanupQueue();
      if (cleanedUp > 0) {
        console.log(`CoverProcessor: Cleaned up ${cleanedUp} old queue items`);
      }

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

  // Run cleanup every 24 hours
  cleanupInterval = Meteor.setInterval(async () => {
    try {
      const cleanedUp = await cleanupQueue();
      if (cleanedUp > 0) {
        console.log(`CoverProcessor: Cleaned up ${cleanedUp} old queue items`);
      }
    } catch (error) {
      console.error('CoverProcessor: Error during cleanup:', error);
    }
  }, CLEANUP_INTERVAL_MS);
}

// Stop the background processor
export function stopCoverProcessor() {
  if (processingInterval) {
    Meteor.clearInterval(processingInterval);
    processingInterval = null;
  }
  if (cleanupInterval) {
    Meteor.clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  console.log('CoverProcessor: Stopped background processor');
}

// Check if processor is running
export function isProcessorRunning() {
  return processingInterval !== null;
}

// Export for manual triggering if needed
export { queueExistingGamesForCovers };
