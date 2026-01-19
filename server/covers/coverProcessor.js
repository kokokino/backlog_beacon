import { Meteor } from 'meteor/meteor';
import sharp from 'sharp';
import { GameCovers } from './coversCollection.js';
import { 
  getNextQueueItem, 
  markQueueItemCompleted, 
  markQueueItemFailed,
  QueueStatus 
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
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download cover: ${response.status} ${response.statusText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Process a single queue item
async function processQueueItem(item) {
  console.log(`CoverProcessor: Processing game ${item.gameId}, image ${item.igdbImageId}`);
  
  // Download from IGDB
  const imageBuffer = await downloadIgdbCover(item.igdbImageId);
  
  // Convert to WebP
  const webpBuffer = await convertToWebP(imageBuffer);
  
  // Save using FilesCollection
  const fileName = `${item.igdbImageId}.webp`;
  
  // Write to FilesCollection
  const fileId = await new Promise((resolve, reject) => {
    GameCovers.write(webpBuffer, {
      fileName: fileName,
      type: 'image/webp',
      meta: {
        gameId: item.gameId,
        igdbImageId: item.igdbImageId,
        processedAt: new Date()
      }
    }, (writeError, fileRef) => {
      if (writeError) {
        reject(writeError);
      } else {
        resolve(fileRef._id);
      }
    });
  });
  
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

// Start the background processor
export function startCoverProcessor() {
  if (processingInterval) {
    console.log('CoverProcessor: Already running');
    return;
  }
  
  console.log('CoverProcessor: Starting background processor');
  
  // Process immediately on start
  processQueue();
  
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
