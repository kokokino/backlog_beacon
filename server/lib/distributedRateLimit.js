import { RateLimits } from '../../imports/lib/collections/rateLimits.js';

/**
 * Check and increment a distributed rate limit counter.
 * Uses MongoDB atomic operations to ensure consistency across multiple instances.
 *
 * @param {string} key - Unique identifier for this rate limit (e.g., 'igdb', 'userId:methodName')
 * @param {number} maxRequests - Maximum requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<{allowed: boolean, count: number, retryAfter?: number}>}
 */
export async function checkDistributedRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Atomic findAndModify - increment count and set windowStart if new
  const result = await RateLimits.rawCollection().findOneAndUpdate(
    { _id: key },
    {
      $inc: { count: 1 },
      $setOnInsert: { windowStart: now }
    },
    { upsert: true, returnDocument: 'after' }
  );

  const record = result;

  // Check if window has expired
  if (record.windowStart < windowStart) {
    // Window expired - reset counter atomically
    await RateLimits.rawCollection().updateOne(
      { _id: key, windowStart: record.windowStart }, // Only if not already reset by another instance
      { $set: { count: 1, windowStart: now } }
    );
    return { allowed: true, count: 1 };
  }

  // Window still active - check if over limit
  const allowed = record.count <= maxRequests;
  const retryAfter = allowed ? undefined : windowMs - (now - record.windowStart);

  return { allowed, count: record.count, retryAfter };
}

/**
 * Wait until rate limit allows the next request.
 * Use this for background processes that should wait rather than fail.
 *
 * @param {string} key - Rate limit key
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<void>}
 */
export async function waitForRateLimit(key, maxRequests, windowMs) {
  const result = await checkDistributedRateLimit(key, maxRequests, windowMs);

  if (!result.allowed && result.retryAfter) {
    await new Promise(resolve => setTimeout(resolve, result.retryAfter));
    // After waiting, we need to check again (another instance may have used the slot)
    return waitForRateLimit(key, maxRequests, windowMs);
  }
}

/**
 * Check a per-user rate limit with a simple cooldown (e.g., "one request per 500ms per user")
 *
 * @param {string} key - Unique key (e.g., 'igdb-search:userId')
 * @param {number} cooldownMs - Minimum time between requests
 * @returns {Promise<{allowed: boolean, waitMs?: number}>}
 */
export async function checkCooldownRateLimit(key, cooldownMs) {
  const now = Date.now();

  // Try to set the timestamp atomically - only succeeds if key doesn't exist or is expired
  const result = await RateLimits.rawCollection().findOneAndUpdate(
    { _id: key },
    { $set: { lastRequest: now } },
    { upsert: true, returnDocument: 'before' }
  );

  // If no previous record, this is the first request
  if (!result) {
    return { allowed: true };
  }

  const timeSinceLastRequest = now - (result.lastRequest || 0);

  if (timeSinceLastRequest >= cooldownMs) {
    return { allowed: true };
  }

  return {
    allowed: false,
    waitMs: cooldownMs - timeSinceLastRequest
  };
}
