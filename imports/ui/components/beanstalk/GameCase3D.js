/**
 * GameCase3D.js - DVD/CD case mesh with cover texture
 */

import * as BABYLON from '@babylonjs/core';
import { getCoverUrl as getCoverUrlFromLib } from '../../lib/coverUrls.js';

// Enable CORS for texture loading (required for cross-origin images in WebGL)
BABYLON.Tools.CorsBehavior = 'anonymous';

// DVD case proportions (relative units)
const CASE_WIDTH = 13.5;
const CASE_HEIGHT = 19;
const CASE_DEPTH = 1.5;

/**
 * Get the cover URL for a game with fallback chain
 * Re-exported from shared coverUrls module for backwards compatibility
 */
export function getCoverUrl(game) {
  return getCoverUrlFromLib(game);
}

/**
 * Create a game case mesh
 */
export function createGameCase(scene, textureCache) {
  // Create box mesh with DVD proportions
  const mesh = BABYLON.MeshBuilder.CreateBox('gameCase', {
    width: CASE_WIDTH,
    height: CASE_HEIGHT,
    depth: CASE_DEPTH,
    faceUV: [
      new BABYLON.Vector4(1, 1, 0, 0), // front - full cover texture (U and V flipped)
      new BABYLON.Vector4(0, 0, 0, 0), // back
      new BABYLON.Vector4(0, 0, 0, 0), // right
      new BABYLON.Vector4(0, 0, 0, 0), // left
      new BABYLON.Vector4(0, 0, 0, 0), // top
      new BABYLON.Vector4(0, 0, 0, 0)  // bottom
    ]
  }, scene);

  // Create PBR material for nice reflections
  const material = new BABYLON.PBRMaterial('caseMat', scene);
  material.metallic = 0;
  material.roughness = 0.3;
  material.albedoColor = new BABYLON.Color3(0.9, 0.9, 0.9);
  material.unlit = true;

  // Backface culling off for solid case
  material.backFaceCulling = false;

  mesh.material = material;

  // Metadata for game data
  mesh.metadata = {
    gameData: null,
    gameIndex: -1,
    collectionItem: null
  };

  return mesh;
}

/**
 * Apply cover texture to a game case
 * Uses robust texture loading with retries and placeholders
 */
export function applyGameCoverTexture(scene, mesh, coverUrl, textureCache) {
  const material = mesh.material;

  // Request texture - returns placeholder immediately, updates material async when loaded
  const currentTexture = textureCache.requestTexture(coverUrl, scene, mesh, material);
  material.albedoTexture = currentTexture;
}

/**
 * Update billboard rotation to face camera (Y-axis only)
 */
export function updateCaseBillboard(mesh, cameraPosition) {
  const dx = cameraPosition.x - mesh.position.x;
  const dz = cameraPosition.z - mesh.position.z;
  mesh.rotation.y = Math.atan2(dx, dz);
}

/**
 * GameCase3D class for managing case mesh lifecycle
 */
export class GameCase3D {
  constructor(scene, textureCache) {
    this.scene = scene;
    this.textureCache = textureCache;
    this.mesh = createGameCase(scene, textureCache);
    this.gameData = null;
    this.gameIndex = -1;
    this.collectionItem = null;
  }

  setGame(game, collectionItem, gameIndex) {
    this.gameData = game;
    this.collectionItem = collectionItem;
    this.gameIndex = gameIndex;

    // Update mesh metadata
    this.mesh.metadata = {
      gameData: game,
      gameIndex: gameIndex,
      collectionItem: collectionItem
    };

    // Apply cover texture
    const coverUrl = getCoverUrl(game);
    applyGameCoverTexture(this.scene, this.mesh, coverUrl, this.textureCache);
  }

  updateBillboard(cameraPosition) {
    updateCaseBillboard(this.mesh, cameraPosition);
  }

  setEnabled(enabled) {
    this.mesh.setEnabled(enabled);
  }

  get position() {
    return this.mesh.position;
  }

  get rotation() {
    return this.mesh.rotation;
  }

  get scaling() {
    return this.mesh.scaling;
  }

  dispose() {
    if (this.mesh.material) {
      // Don't dispose texture - it's cached
      this.mesh.material.dispose();
    }
    this.mesh.dispose();
  }
}
