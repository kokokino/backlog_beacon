/**
 * BeanstalkPool.js - Object pooling for leaves/cases and texture caching
 */

/**
 * Simple object pool for reusing meshes
 */
export class ObjectPool {
  constructor() {
    this.pool = [];
    this.avail = [];
    this.createObject = () => ({});
  }

  getObject() {
    if (this.avail.length === 0) {
      const obj = this.createObject();
      obj.poolId = this.pool.length;
      this.pool.push(obj);
      this.avail.push(obj.poolId);
    }

    const poolId = this.avail.pop();
    return this.pool[poolId];
  }

  returnObject(poolId) {
    this.avail.push(poolId);
  }

  dispose() {
    this.pool.forEach(obj => {
      if (obj && typeof obj.dispose === 'function') {
        obj.dispose();
      }
    });
    this.pool = [];
    this.avail = [];
  }

  async disposeAsync(label = 'ObjectPool') {
    const CHUNK_SIZE = 10;
    const t0 = performance.now();
    console.log(`[dispose:${label}] START — pool size: ${this.pool.length}, available: ${this.avail.length}`);

    for (let i = 0; i < this.pool.length; i += CHUNK_SIZE) {
      const chunkStart = performance.now();
      const chunk = this.pool.slice(i, i + CHUNK_SIZE);
      chunk.forEach(obj => {
        if (obj && typeof obj.dispose === 'function') {
          obj.dispose();
        }
      });
      const chunkMs = performance.now() - chunkStart;
      console.log(`[dispose:${label}] chunk ${i}-${i + chunk.length - 1} disposed in ${chunkMs.toFixed(1)}ms`);
      // Yield a full frame to browser
      await new Promise(resolve => requestAnimationFrame(resolve));
    }

    this.pool = [];
    this.avail = [];
    console.log(`[dispose:${label}] DONE — total ${(performance.now() - t0).toFixed(1)}ms`);
  }
}

/**
 * Texture loading states
 */
const TextureState = {
  PENDING: 'pending',
  LOADING: 'loading',
  LOADED: 'loaded',
  FAILED: 'failed'
};

/**
 * Entry tracking a texture's loading state and callbacks
 */
class TextureEntry {
  constructor(url) {
    this.url = url;
    this.state = TextureState.PENDING;
    this.texture = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.timeoutMs = 15000;
    this.timeoutId = null;
    this.callbacks = [];  // {mesh, material} to update on load
    this.triedProxy = false;  // Whether we've tried the CORS proxy fallback
    this.loadStartTime = null;  // When the current load attempt started
    this.disposed = false;  // Set true when evicted, prevents orphaned async loads
  }
}

/**
 * LRU texture cache with robust loading, retries, and placeholders
 */
export class TextureCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.entries = new Map();
    this.accessOrder = [];
    this.loadingPlaceholder = null;
    this.errorPlaceholder = null;
    this.scene = null;
  }

  /**
   * Initialize placeholder textures (call after scene is ready)
   */
  initPlaceholders(scene) {
    this.scene = scene;

    // Gray gradient SVG for loading state
    const loadingDataUrl = 'data:image/svg+xml;base64,' + btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
        <defs>
          <linearGradient id="loadingGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#d0d0d0"/>
            <stop offset="100%" style="stop-color:#a0a0a0"/>
          </linearGradient>
        </defs>
        <rect width="300" height="400" fill="url(#loadingGrad)"/>
      </svg>
    `.trim());

    // Error placeholder - "No Cover" text
    const errorDataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgMzAwIDQwMCI+CiAgPHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNmMGYwZjAiLz4KICA8dGV4dCB4PSIxNTAiIHk9IjIwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2FhYSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2Ij5ObyBDb3ZlcjwvdGV4dD4KPC9zdmc+';

    // Import BABYLON dynamically to avoid circular dependencies
    import('@babylonjs/core').then((BABYLON) => {
      this.loadingPlaceholder = new BABYLON.Texture(loadingDataUrl, scene);
      this.errorPlaceholder = new BABYLON.Texture(errorDataUrl, scene);
    });
  }

  /**
   * Request a texture - returns placeholder immediately, updates material async
   * @param {string} url - Texture URL
   * @param {BABYLON.Scene} scene - Babylon scene
   * @param {BABYLON.Mesh} mesh - Mesh to update
   * @param {BABYLON.Material} material - Material to update with loaded texture
   * @returns {BABYLON.Texture} - Placeholder or cached texture
   */
  requestTexture(url, scene, mesh, material) {
    // Check for existing entry
    let entry = this.entries.get(url);

    if (entry) {
      // Move to end of access order (most recently used)
      const index = this.accessOrder.indexOf(url);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(url);

      switch (entry.state) {
        case TextureState.LOADED:
          return entry.texture;

        case TextureState.LOADING:
          // Add callback to update this material when load completes
          entry.callbacks.push({ mesh, material });
          return this.loadingPlaceholder;

        case TextureState.FAILED:
          return this.errorPlaceholder;

        case TextureState.PENDING:
          // Shouldn't happen, but handle it
          entry.callbacks.push({ mesh, material });
          this._startLoad(entry, scene);
          return this.loadingPlaceholder;
      }
    }

    // New texture - create entry and start loading
    entry = new TextureEntry(url);
    entry.callbacks.push({ mesh, material });

    // Evict oldest if at capacity
    this._evictIfNeeded();

    this.entries.set(url, entry);
    this.accessOrder.push(url);

    this._startLoad(entry, scene);
    return this.loadingPlaceholder;
  }

  /**
   * Start loading a texture with timeout
   */
  _startLoad(entry, scene) {
    entry.state = TextureState.LOADING;
    entry.loadStartTime = Date.now();

    import('@babylonjs/core').then((BABYLON) => {
      // Evicted with no callbacks waiting — skip texture creation entirely
      if (entry.disposed && entry.callbacks.length === 0) return;

      // Set up timeout
      entry.timeoutId = setTimeout(() => {
        this._onLoadError(entry, scene, 'Timeout');
      }, entry.timeoutMs);

      // Create texture with success/error callbacks
      entry.texture = new BABYLON.Texture(
        entry.url,
        scene,
        false,  // noMipmap
        true,   // invertY
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        () => { // onLoad success
          this._onLoadSuccess(entry);
        },
        () => { // onLoad error
          this._onLoadError(entry, scene, 'Load failed');
        }
      );
    });
  }

  /**
   * Handle successful texture load
   */
  _onLoadSuccess(entry) {
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
      entry.timeoutId = null;
    }

    // Entry was evicted while loading
    if (entry.disposed) {
      if (entry.callbacks.length > 0) {
        // Fulfill callbacks so visible materials update — texture becomes
        // untracked but still referenced by materials, cleaned up at scene disposal
        for (const callback of entry.callbacks) {
          if (callback.material && !callback.material.isDisposed) {
            callback.material.albedoTexture = entry.texture;
          }
        }
        entry.callbacks = [];
      } else if (entry.texture) {
        // No callbacks — orphaned texture, dispose immediately
        entry.texture.dispose();
        entry.texture = null;
      }
      return;
    }

    entry.state = TextureState.LOADED;

    // Update all waiting materials
    for (const callback of entry.callbacks) {
      if (callback.material && !callback.material.isDisposed) {
        callback.material.albedoTexture = entry.texture;
      }
    }
    entry.callbacks = [];
  }

  /**
   * Handle texture load error
   */
  _onLoadError(entry, scene, reason) {
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
      entry.timeoutId = null;
    }

    // Entry was evicted while loading — dispose the orphaned texture
    if (entry.disposed) {
      if (entry.texture) {
        entry.texture.dispose();
        entry.texture = null;
      }
      return;
    }

    // Dispose failed texture
    if (entry.texture) {
      entry.texture.dispose();
      entry.texture = null;
    }

    // CORS detection: fast failures (< 1 second) on cross-origin URLs likely indicate CORS
    const loadDuration = Date.now() - (entry.loadStartTime || 0);
    const isFastFail = loadDuration < 1000;
    const isCrossOrigin = entry.url.startsWith('http') &&
      !entry.url.includes(window.location.hostname);

    // If fast fail on cross-origin URL and haven't tried proxy yet, try the server proxy
    if (!entry.triedProxy && isFastFail && isCrossOrigin) {
      entry.triedProxy = true;
      this._tryProxyLoad(entry, scene);
      return;
    }

    entry.retryCount++;

    if (entry.retryCount < entry.maxRetries) {
      // Schedule retry with exponential backoff
      this._scheduleRetry(entry, scene);
    } else {
      // Max retries exceeded - mark as failed
      entry.state = TextureState.FAILED;

      // Apply error placeholder to all waiting materials
      for (const callback of entry.callbacks) {
        if (callback.material && !callback.material.isDisposed) {
          callback.material.albedoTexture = this.errorPlaceholder;
        }
      }
      entry.callbacks = [];

      // Remove from cache so it can be retried later if needed
      this.entries.delete(entry.url);
      const index = this.accessOrder.indexOf(entry.url);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }
  }

  /**
   * Try loading the texture via the server-side CORS proxy
   */
  _tryProxyLoad(entry, scene) {
    // Build proxy URL
    const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(entry.url)}`;

    entry.state = TextureState.LOADING;
    entry.loadStartTime = Date.now();

    import('@babylonjs/core').then((BABYLON) => {
      // Evicted with no callbacks waiting — skip texture creation entirely
      if (entry.disposed && entry.callbacks.length === 0) return;

      entry.timeoutId = setTimeout(() => {
        this._onLoadError(entry, scene, 'Proxy timeout');
      }, entry.timeoutMs);

      // Create texture from proxy URL (same-origin, no CORS issues)
      entry.texture = new BABYLON.Texture(
        proxyUrl,
        scene,
        false,  // noMipmap
        true,   // invertY
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        () => this._onLoadSuccess(entry),
        () => this._onLoadError(entry, scene, 'Proxy load failed')
      );
    });
  }

  /**
   * Schedule a retry with exponential backoff
   */
  _scheduleRetry(entry, scene) {
    // Exponential backoff: 2s, 4s, 8s
    const delay = Math.pow(2, entry.retryCount) * 1000;

    entry.state = TextureState.PENDING;

    setTimeout(() => {
      // Only retry if still in cache and not already loading
      if (this.entries.has(entry.url) && entry.state === TextureState.PENDING) {
        this._startLoad(entry, scene);
      }
    }, delay);
  }

  /**
   * Evict oldest entries if at capacity.
   * Sets disposed flag so async callbacks handle cleanup:
   *   - _startLoad/_tryProxyLoad: skip texture creation if no callbacks waiting
   *   - _onLoadSuccess: fulfill callbacks then leave texture (materials reference it)
   *   - _onLoadError: dispose texture and stop retries
   *   - _scheduleRetry: entries.has() check prevents retry
   * Loaded textures are disposed immediately — pooled cases have released their
   * references via releaseTexture(), and visible cases' textures are at the front
   * of the LRU (not evicted).
   */
  _evictIfNeeded() {
    while (this.entries.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      const entry = this.entries.get(oldest);
      if (entry) {
        entry.disposed = true;
        if (entry.texture && entry.state === TextureState.LOADED) {
          entry.texture.dispose();
          entry.texture = null;
        }
      }
      this.entries.delete(oldest);
    }
  }

  /**
   * Legacy get method for compatibility
   */
  get(url) {
    const entry = this.entries.get(url);
    if (entry && entry.state === TextureState.LOADED) {
      // Move to end of access order
      const index = this.accessOrder.indexOf(url);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(url);
      return entry.texture;
    }
    return null;
  }

  /**
   * Legacy set method for compatibility
   */
  set(url, texture) {
    this._evictIfNeeded();

    const entry = new TextureEntry(url);
    entry.state = TextureState.LOADED;
    entry.texture = texture;

    this.entries.set(url, entry);
    this.accessOrder.push(url);
  }

  /**
   * Preload textures without waiting for them to be assigned to materials
   * Starts loading textures that aren't already cached or loading
   *
   * @param {string[]} urls - Array of texture URLs to preload
   * @param {BABYLON.Scene} scene - Babylon scene for texture creation
   */
  preloadTextures(urls, scene) {
    if (!scene) {
      scene = this.scene;
    }
    if (!scene) {
      return; // No scene available
    }

    for (const url of urls) {
      if (!url || url.startsWith('data:')) {
        continue; // Skip null/undefined and data URIs
      }

      let entry = this.entries.get(url);

      if (entry) {
        // Move to end of access order (most recently used)
        const index = this.accessOrder.indexOf(url);
        if (index > -1) {
          this.accessOrder.splice(index, 1);
        }
        this.accessOrder.push(url);

        // Already cached or loading - skip
        if (entry.state === TextureState.LOADED ||
            entry.state === TextureState.LOADING) {
          continue;
        }

        // Entry exists but failed or pending - try loading again
        if (entry.state === TextureState.PENDING) {
          this._startLoad(entry, scene);
        }
      } else {
        // New texture - create entry and start loading
        this._evictIfNeeded();

        entry = new TextureEntry(url);
        // Preloaded textures have no callbacks - they'll be picked up by requestTexture later
        entry.callbacks = [];

        this.entries.set(url, entry);
        this.accessOrder.push(url);

        this._startLoad(entry, scene);
      }
    }
  }

  dispose() {
    // Clear all timeouts and dispose textures
    this.entries.forEach(entry => {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      if (entry.texture) {
        entry.texture.dispose();
      }
    });
    this.entries.clear();
    this.accessOrder = [];

    // Dispose placeholders
    if (this.loadingPlaceholder) {
      this.loadingPlaceholder.dispose();
      this.loadingPlaceholder = null;
    }
    if (this.errorPlaceholder) {
      this.errorPlaceholder.dispose();
      this.errorPlaceholder = null;
    }
  }

  async disposeAsync() {
    const t0 = performance.now();
    const entries = Array.from(this.entries.values());

    // Count entries by state
    const stateCounts = { loaded: 0, loading: 0, pending: 0, failed: 0 };
    let withTexture = 0;
    for (const entry of entries) {
      stateCounts[entry.state] = (stateCounts[entry.state] || 0) + 1;
      if (entry.texture) {
        withTexture++;
      }
    }
    console.log(`[dispose:textureCache] START — entries: ${entries.length}, loaded: ${stateCounts.loaded}, loading: ${stateCounts.loading}, pending: ${stateCounts.pending}, failed: ${stateCounts.failed}, withTexture: ${withTexture}`);

    const CHUNK_SIZE = 10;
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunkStart = performance.now();
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      chunk.forEach(entry => {
        if (entry.timeoutId) {
          clearTimeout(entry.timeoutId);
        }
        if (entry.texture) {
          entry.texture.dispose();
        }
      });
      const chunkMs = performance.now() - chunkStart;
      console.log(`[dispose:textureCache] chunk ${i}-${i + chunk.length - 1} disposed in ${chunkMs.toFixed(1)}ms`);
      // Yield a full frame to browser
      await new Promise(resolve => requestAnimationFrame(resolve));
    }

    this.entries.clear();
    this.accessOrder = [];

    // Dispose placeholders
    if (this.loadingPlaceholder) {
      this.loadingPlaceholder.dispose();
      this.loadingPlaceholder = null;
    }
    if (this.errorPlaceholder) {
      this.errorPlaceholder.dispose();
      this.errorPlaceholder = null;
    }

    console.log(`[dispose:textureCache] DONE — total ${(performance.now() - t0).toFixed(1)}ms`);
  }
}

/**
 * Easing functions for animations
 */
export const Easing = {
  Sinusoidal: {
    EaseIn: (k) => 1 - Math.cos(k * Math.PI / 2),
    EaseOut: (k) => Math.sin(k * Math.PI / 2),
    EaseInOut: (k) => 0.5 * (1 - Math.cos(Math.PI * k))
  },
  Linear: {
    None: (k) => k
  }
};

/**
 * Animation manager for tweens
 */
export class AnimationManager {
  constructor() {
    this.animations = [];
  }

  add(animation) {
    this.animations.push(animation);
    return animation;
  }

  remove(animation) {
    const index = this.animations.indexOf(animation);
    if (index !== -1) {
      this.animations.splice(index, 1);
    }
  }

  update() {
    const time = performance.now();
    for (let i = this.animations.length - 1; i >= 0; i--) {
      this.animations[i].update(time);
    }
  }
}

/**
 * Tween class for animating properties
 */
export class Tween {
  constructor(object, manager) {
    this.object = object;
    this.manager = manager;
    this.startValues = {};
    this.endValues = {};
    this.duration = 1000;
    this.delayTime = 0;
    this.startTime = null;
    this.easingFunction = Easing.Linear.None;
    this.onCompleteCallback = null;
    this.chainedTween = null;
    this.isPlaying = false;
  }

  to(properties, duration) {
    this.endValues = properties;
    if (duration !== undefined) {
      this.duration = duration;
    }
    return this;
  }

  easing(easingFunction) {
    this.easingFunction = easingFunction;
    return this;
  }

  delay(amount) {
    this.delayTime = amount;
    return this;
  }

  onComplete(callback) {
    this.onCompleteCallback = callback;
    return this;
  }

  chain(tween) {
    this.chainedTween = tween;
    return this;
  }

  start() {
    this.isPlaying = true;
    this.startTime = performance.now() + this.delayTime;

    for (const property in this.endValues) {
      this.startValues[property] = this.object[property];
    }

    if (this.manager) {
      this.manager.add(this);
    }
    return this;
  }

  stop() {
    this.isPlaying = false;
    if (this.manager) {
      this.manager.remove(this);
    }
    return this;
  }

  update(time) {
    if (!this.isPlaying) {
      return false;
    }

    if (time < this.startTime) {
      return true;
    }

    let elapsed = (time - this.startTime) / this.duration;
    elapsed = elapsed > 1 ? 1 : elapsed;

    const value = this.easingFunction(elapsed);

    for (const property in this.endValues) {
      const start = this.startValues[property];
      const end = this.endValues[property];
      this.object[property] = start + (end - start) * value;
    }

    if (elapsed === 1) {
      this.isPlaying = false;
      if (this.manager) {
        this.manager.remove(this);
      }
      if (this.onCompleteCallback) {
        this.onCompleteCallback();
      }
      if (this.chainedTween) {
        this.chainedTween.start();
      }
      return false;
    }

    return true;
  }
}
