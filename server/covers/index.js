// Cover image handling module
// Exports all cover-related functionality

export { GameCovers } from './coversCollection.js';

export {
  CoverQueue,
  QueueStatus,
  queueCoverDownload,
  queueMultipleCoverDownloads,
  claimNextQueueItem,
  markQueueItemCompleted,
  markQueueItemFailed,
  cleanupQueue,
  getQueueStats
} from './coverQueue.js';

export {
  startCoverProcessor,
  stopCoverProcessor,
  isProcessorRunning
} from './coverProcessor.js';

export {
  getGameCoverUrl,
  getGameCoverUrlAsync,
  getGameCoverUrls,
  hasLocalCover,
  needsCoverProcessing
} from './coverHelpers.js';
