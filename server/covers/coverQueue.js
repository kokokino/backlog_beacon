import { Mongo } from 'meteor/mongo';

// Queue collection for cover image processing
export const CoverQueue = new Mongo.Collection('coverQueue');

// Queue item statuses
export const QueueStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Add a game to the cover processing queue
export async function queueCoverDownload(gameId, igdbImageId, priority = 5) {
  if (!gameId || !igdbImageId) {
    return null;
  }
  
  // Check if already queued or completed
  const existing = await CoverQueue.findOneAsync({
    gameId: gameId,
    status: { $in: [QueueStatus.PENDING, QueueStatus.PROCESSING, QueueStatus.COMPLETED] }
  });
  
  if (existing) {
    return existing._id;
  }
  
  // Add to queue
  const queueId = await CoverQueue.insertAsync({
    gameId: gameId,
    igdbImageId: igdbImageId,
    status: QueueStatus.PENDING,
    priority: priority,
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  return queueId;
}

// Queue multiple games at once
export async function queueMultipleCoverDownloads(games, priority = 5) {
  const queuedIds = [];
  
  for (const game of games) {
    if (game._id && game.coverImageId) {
      const queueId = await queueCoverDownload(game._id, game.coverImageId, priority);
      if (queueId) {
        queuedIds.push(queueId);
      }
    }
  }
  
  return queuedIds;
}

// Atomically claim the next queue item for processing
// Uses findOneAndUpdate to ensure only one instance can claim each item
export async function claimNextQueueItem(instanceId) {
  const result = await CoverQueue.rawCollection().findOneAndUpdate(
    { status: QueueStatus.PENDING },
    {
      $set: {
        status: QueueStatus.PROCESSING,
        claimedBy: instanceId,
        claimedAt: new Date(),
        updatedAt: new Date()
      },
      $inc: { attempts: 1 }
    },
    {
      sort: { priority: 1, createdAt: 1 },
      returnDocument: 'after'
    }
  );

  return result || null;
}

// Mark item as completed
export async function markQueueItemCompleted(queueId, coverId) {
  await CoverQueue.updateAsync(queueId, {
    $set: {
      status: QueueStatus.COMPLETED,
      coverId: coverId,
      completedAt: new Date(),
      updatedAt: new Date()
    }
  });
}

// Mark item as failed
export async function markQueueItemFailed(queueId, error) {
  const item = await CoverQueue.findOneAsync(queueId);
  
  if (!item) {
    return;
  }
  
  const newStatus = item.attempts >= item.maxAttempts 
    ? QueueStatus.FAILED 
    : QueueStatus.PENDING;
  
  await CoverQueue.updateAsync(queueId, {
    $set: {
      status: newStatus,
      lastError: error,
      updatedAt: new Date()
    }
  });
}

// Clean up old completed/failed items (call periodically)
export async function cleanupQueue(maxAgeDays = 7) {
  const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  
  const result = await CoverQueue.removeAsync({
    status: { $in: [QueueStatus.COMPLETED, QueueStatus.FAILED] },
    updatedAt: { $lt: cutoffDate }
  });
  
  return result;
}

// Get queue statistics
export async function getQueueStats() {
  const pending = await CoverQueue.find({ status: QueueStatus.PENDING }).countAsync();
  const processing = await CoverQueue.find({ status: QueueStatus.PROCESSING }).countAsync();
  const completed = await CoverQueue.find({ status: QueueStatus.COMPLETED }).countAsync();
  const failed = await CoverQueue.find({ status: QueueStatus.FAILED }).countAsync();
  
  return { pending, processing, completed, failed };
}
