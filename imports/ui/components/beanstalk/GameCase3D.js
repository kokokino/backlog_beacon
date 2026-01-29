/**
 * GameCase3D.js - DVD/CD case mesh with cover texture
 */

import * as BABYLON from '@babylonjs/core';

// DVD case proportions (relative units)
const CASE_WIDTH = 13.5;
const CASE_HEIGHT = 19;
const CASE_DEPTH = 1.5;

// SVG placeholder for games without covers (same as GameCard)
const noCoverDataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgMzAwIDQwMCI+CiAgPHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNmMGYwZjAiLz4KICA8dGV4dCB4PSIxNTAiIHk9IjIwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2FhYSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2Ij5ObyBDb3ZlcjwvdGV4dD4KPC9zdmc+';

/**
 * Get the cover URL for a game with fallback chain
 */
export function getCoverUrl(game) {
  if (!game) {
    return noCoverDataUrl;
  }

  // Local cover takes priority
  if (game.localCoverUrl) {
    return game.localCoverUrl;
  }

  // IGDB cover from coverImageId
  if (game.coverImageId) {
    return `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.coverImageId}.jpg`;
  }

  // Direct IGDB URL
  if (game.igdbCoverUrl) {
    return game.igdbCoverUrl;
  }

  // Legacy coverUrl field
  if (game.coverUrl) {
    return game.coverUrl;
  }

  return noCoverDataUrl;
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
      new BABYLON.Vector4(0, 0, 1, 1), // front - full cover texture
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
 */
export function applyGameCoverTexture(scene, mesh, coverUrl, textureCache) {
  const material = mesh.material;

  // Check cache first
  let texture = textureCache.get(coverUrl);

  if (!texture) {
    texture = new BABYLON.Texture(coverUrl, scene, false, true, BABYLON.Texture.BILINEAR_SAMPLINGMODE, null, () => {
      // Error callback - use placeholder
      if (texture && !texture.isReady()) {
        const placeholderTexture = new BABYLON.Texture(noCoverDataUrl, scene);
        material.albedoTexture = placeholderTexture;
      }
    });
    textureCache.set(coverUrl, texture);
  }

  material.albedoTexture = texture;
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
