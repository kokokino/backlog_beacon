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
 * LRU texture cache with automatic disposal
 */
export class TextureCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessOrder = [];
  }

  get(url) {
    if (this.cache.has(url)) {
      // Move to end of access order (most recently used)
      const index = this.accessOrder.indexOf(url);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(url);
      return this.cache.get(url);
    }
    return null;
  }

  set(url, texture) {
    // Evict oldest if at capacity
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      const oldTexture = this.cache.get(oldest);
      if (oldTexture) {
        oldTexture.dispose();
      }
      this.cache.delete(oldest);
    }

    this.cache.set(url, texture);
    this.accessOrder.push(url);
  }

  dispose() {
    this.cache.forEach(texture => {
      if (texture) {
        texture.dispose();
      }
    });
    this.cache.clear();
    this.accessOrder = [];
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
