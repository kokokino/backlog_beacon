/**
 * BeanstalkEffects.js - Fairy light particles and glow effects
 */

import * as BABYLON from '@babylonjs/core';

/**
 * Create fairy light particle system
 */
export function createFairyLights(scene, emitter) {
  const particles = new BABYLON.ParticleSystem('fairyLights', 100, scene);

  // Use procedural texture for particles (circle)
  particles.particleTexture = new BABYLON.Texture('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTQiIGZpbGw9IndoaXRlIi8+PC9zdmc+', scene);

  // Emission - use world-space position instead of mesh emitter
  particles.emitter = new BABYLON.Vector3(0, 0, 0);
  particles.minEmitBox = new BABYLON.Vector3(-150, -200, -50);
  particles.maxEmitBox = new BABYLON.Vector3(150, 200, 50);
  particles.emitRate = 10;

  // Lifetime
  particles.minLifeTime = 3;
  particles.maxLifeTime = 6;

  // Size - larger for visibility at camera distance
  particles.minSize = 1; //0.5; //8;
  particles.maxSize = 3; //2; //20;

  // Colors - warm gold to cool blue gradient
  particles.color1 = new BABYLON.Color4(1, 0.9, 0.5, 1);      // warm gold
  particles.color2 = new BABYLON.Color4(0.5, 0.8, 1, 1);      // cool blue
  particles.colorDead = new BABYLON.Color4(0.5, 0.8, 1, 0);   // fade out

  // Speed
  particles.minEmitPower = 0.5;
  particles.maxEmitPower = 1.5;
  particles.updateSpeed = 0.01;

  // Direction - gentle upward float (world-space)
  particles.direction1 = new BABYLON.Vector3(-0.5, 1, -0.3);
  particles.direction2 = new BABYLON.Vector3(0.5, 2, 0.3);

  // Gravity - gentle float up
  particles.gravity = new BABYLON.Vector3(0, 0.5, 0);

  // Blend mode for glow effect
  particles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  return particles;
}

/**
 * Create glow layer for scene
 */
export function createGlowLayer(scene) {
  const glow = new BABYLON.GlowLayer('glow', scene);
  glow.intensity = 0.5;
  return glow;
}

/**
 * Selection highlight effect
 */
export class SelectionHighlight {
  constructor(scene) {
    this.scene = scene;
    this.light = null;
    this.animating = false;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.decayRate = 0.05;
  }

  /**
   * Show highlight at position
   */
  highlight(position) {
    if (!this.light) {
      this.light = new BABYLON.PointLight('selectionLight', position.clone(), this.scene);
      this.light.diffuse = new BABYLON.Color3(1, 0.9, 0.5);
      this.light.specular = new BABYLON.Color3(1, 0.9, 0.5);
      this.light.range = 50;
    }

    this.light.position.copyFrom(position);
    this.targetIntensity = 1.5;
    this.animating = true;
  }

  /**
   * Update highlight animation - call each frame
   */
  update() {
    if (!this.animating || !this.light) {
      return;
    }

    // Animate towards target then decay
    if (this.intensity < this.targetIntensity) {
      this.intensity += 0.2;
      if (this.intensity >= this.targetIntensity) {
        this.targetIntensity = 0;
      }
    } else {
      this.intensity -= this.decayRate;
      if (this.intensity <= 0) {
        this.intensity = 0;
        this.animating = false;
      }
    }

    this.light.intensity = this.intensity;
  }

  dispose() {
    if (this.light) {
      this.light.dispose();
      this.light = null;
    }
  }
}

/**
 * BeanstalkEffects manager
 */
export class BeanstalkEffects {
  constructor(scene) {
    this.scene = scene;
    this.fairyLights = null;
    this.fairyLightsActive = false;
    this.glowLayer = null;
    this.selectionHighlight = null;
  }

  init(plantMesh) {
    // Create fairy lights (but don't start yet - wait for games in viewport)
    this.fairyLights = createFairyLights(this.scene, plantMesh);

    // Create glow layer
    this.glowLayer = createGlowLayer(this.scene);

    // Create selection highlight
    this.selectionHighlight = new SelectionHighlight(this.scene);
  }

  startFairyLights() {
    if (!this.fairyLightsActive && this.fairyLights) {
      this.fairyLights.start();
      this.fairyLightsActive = true;
    }
  }

  update() {
    if (this.selectionHighlight) {
      this.selectionHighlight.update();
    }
  }

  highlightGame(position) {
    if (this.selectionHighlight) {
      this.selectionHighlight.highlight(position);
    }
  }

  /**
   * Add mesh to glow layer
   */
  addGlow(mesh) {
    if (this.glowLayer) {
      this.glowLayer.addIncludedOnlyMesh(mesh);
    }
  }

  dispose() {
    if (this.fairyLights) {
      this.fairyLights.dispose();
      this.fairyLights = null;
    }
    if (this.glowLayer) {
      this.glowLayer.dispose();
      this.glowLayer = null;
    }
    if (this.selectionHighlight) {
      this.selectionHighlight.dispose();
      this.selectionHighlight = null;
    }
  }
}
