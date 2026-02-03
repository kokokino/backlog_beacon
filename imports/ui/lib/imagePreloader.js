/**
 * imagePreloader.js - Image preloading utility for HTML-based layouts
 *
 * Provides an LRU cache of preloaded Image objects and scroll tracking
 * for velocity-based lookahead in Infinite and Bookshelf views.
 */

const MAX_CACHE_SIZE = 100;

/**
 * LRU cache entry for a preloaded image
 */
class CacheEntry {
  constructor(url) {
    this.url = url;
    this.image = null;
    this.loading = false;
    this.loaded = false;
    this.failed = false;
  }
}

/**
 * ImagePreloader - manages preloading of cover images
 */
export class ImagePreloader {
  constructor() {
    this.cache = new Map();
    this.accessOrder = [];

    // Scroll tracking state
    this.lastScrollPosition = 0;
    this.lastScrollTime = 0;
    this.scrollDirection = 'idle'; // 'up' | 'down' | 'idle'
    this.scrollVelocity = 0;
    this.velocityHistory = [];
    this.maxVelocityHistory = 5;
  }

  /**
   * Preload an array of image URLs
   *
   * @param {string[]} urls - URLs to preload
   */
  preload(urls) {
    for (const url of urls) {
      if (!url || url.startsWith('data:')) {
        continue; // Skip null/undefined and data URIs
      }

      let entry = this.cache.get(url);

      if (entry) {
        // Move to end of access order (most recently used)
        this._touchEntry(url);

        // Already cached or loading - skip
        if (entry.loaded || entry.loading) {
          continue;
        }
      } else {
        // New entry
        this._evictIfNeeded();
        entry = new CacheEntry(url);
        this.cache.set(url, entry);
        this.accessOrder.push(url);
      }

      // Start loading
      this._loadImage(entry);
    }
  }

  /**
   * Track scroll position to calculate direction and velocity
   *
   * @param {number} position - Current scroll position (scrollTop)
   */
  trackScroll(position) {
    const now = performance.now();
    const timeDelta = now - this.lastScrollTime;

    if (timeDelta > 0 && this.lastScrollTime > 0) {
      const positionDelta = position - this.lastScrollPosition;
      const instantVelocity = Math.abs(positionDelta) / timeDelta * 1000; // px/sec

      // Update direction
      if (positionDelta > 2) {
        this.scrollDirection = 'down';
      } else if (positionDelta < -2) {
        this.scrollDirection = 'up';
      } else if (timeDelta > 150) {
        // Reset to idle after 150ms of no significant movement
        this.scrollDirection = 'idle';
      }

      // Maintain rolling average of velocity
      this.velocityHistory.push(instantVelocity);
      if (this.velocityHistory.length > this.maxVelocityHistory) {
        this.velocityHistory.shift();
      }

      // Calculate smoothed velocity
      this.scrollVelocity = this.velocityHistory.reduce((sum, v) => sum + v, 0) / this.velocityHistory.length;
    }

    this.lastScrollPosition = position;
    this.lastScrollTime = now;
  }

  /**
   * Get current scroll state for preload calculations
   *
   * @returns {{ direction: string, velocity: number }}
   */
  getScrollState() {
    return {
      direction: this.scrollDirection,
      velocity: this.scrollVelocity
    };
  }

  /**
   * Calculate how many items to preload based on scroll velocity
   *
   * Base lookahead: ~15 items
   * Direction bias: 80% in scroll direction, 20% opposite
   * Velocity multiplier: min(3, 1 + velocity/500)
   *
   * @returns {{ ahead: number, behind: number }}
   */
  getLookahead() {
    const baseLookahead = 30;
    const velocityMultiplier = Math.min(3, 1 + this.scrollVelocity / 500);
    const totalLookahead = Math.round(baseLookahead * velocityMultiplier);

    if (this.scrollDirection === 'idle') {
      // When idle, preload equally in both directions
      const half = Math.round(totalLookahead / 2);
      return { ahead: half, behind: half };
    }

    // Direction bias: 80% ahead, 20% behind
    const ahead = Math.round(totalLookahead * 0.8);
    const behind = totalLookahead - ahead;

    return { ahead, behind };
  }

  /**
   * Check if a URL is already loaded or loading
   *
   * @param {string} url - URL to check
   * @returns {boolean}
   */
  isLoaded(url) {
    const entry = this.cache.get(url);
    return entry && entry.loaded;
  }

  /**
   * Move entry to end of access order
   */
  _touchEntry(url) {
    const index = this.accessOrder.indexOf(url);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(url);
  }

  /**
   * Evict oldest entries if at capacity
   */
  _evictIfNeeded() {
    while (this.cache.size >= MAX_CACHE_SIZE && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      this.cache.delete(oldest);
    }
  }

  /**
   * Load an image via new Image()
   */
  _loadImage(entry) {
    entry.loading = true;
    entry.image = new Image();

    entry.image.onload = () => {
      entry.loading = false;
      entry.loaded = true;
    };

    entry.image.onerror = () => {
      entry.loading = false;
      entry.failed = true;
    };

    entry.image.src = entry.url;
  }

  /**
   * Clear the cache and reset state
   */
  dispose() {
    this.cache.clear();
    this.accessOrder = [];
    this.velocityHistory = [];
    this.scrollDirection = 'idle';
    this.scrollVelocity = 0;
  }
}
