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
  }
}

/**
 * LRU texture cache with robust loading, retries, and placeholders
 */
export class TextureCache {
  constructor(maxSize = 50) {
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

    import('@babylonjs/core').then((BABYLON) => {
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
    // Clear timeout
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
      entry.timeoutId = null;
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
    // Clear timeout
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
      entry.timeoutId = null;
    }

    // Dispose failed texture
    if (entry.texture) {
      entry.texture.dispose();
      entry.texture = null;
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
   * Evict oldest entries if at capacity
   */
  _evictIfNeeded() {
    while (this.entries.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      const entry = this.entries.get(oldest);
      if (entry) {
        // Clear any pending timeout
        if (entry.timeoutId) {
          clearTimeout(entry.timeoutId);
        }
        // Dispose texture if loaded
        if (entry.texture) {
          entry.texture.dispose();
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
