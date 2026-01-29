/**
 * BeanstalkScene.js - Scene setup: engine, camera, lighting, sky
 */

import * as BABYLON from '@babylonjs/core';
import { BeanstalkPlant } from './BeanstalkPlant.js';
import { LeafData, createLeafMesh } from './LeafData.js';
import { ObjectPool, TextureCache, AnimationManager, Tween, Easing } from './BeanstalkPool.js';
import { GameCase3D, getCoverUrl } from './GameCase3D.js';
import { BeanstalkInput } from './BeanstalkInput.js';
import { BeanstalkEffects } from './BeanstalkEffects.js';

const TO_RADIANS = Math.PI / 180;

export class BeanstalkScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.onGameSelect = options.onGameSelect || (() => {});
    this.onVisibleRangeChange = options.onVisibleRangeChange || (() => {});
    this.onRequestData = options.onRequestData || (() => {});

    // Babylon.js core
    this.engine = null;
    this.scene = null;
    this.camera = null;

    // Materials
    this.branchMaterial = null;
    this.leafMaterial = null;

    // Scene objects
    this.plant = null;
    this.skyDome = null;
    this.leafStalkMesh = null;
    this.leafBladeMesh = null;

    // Pooling and caching
    this.branchPool = null;
    this.gameCasePool = null;
    this.textureCache = null;

    // Active leaves and cases
    this.branches = [];
    this.gameCases = [];

    // Animation
    this.animationManager = null;
    this.delta = 0;
    this.spawnCounter = 0;
    this.swap = false;

    // Input
    this.input = null;

    // Effects
    this.effects = null;

    // Data bridge
    this.items = [];
    this.games = {};
    this.totalCount = 0;
    this.gamePositionOffset = 0;  // Y offset for game index calculation

    // Initialize
    this.init();
  }

  async init() {
    this.initEngine();
    this.initMaterials();
    this.initObjects();
    this.initInput();
    this.initEffects();
    this.initStartAnim();

    // Start render loop
    this.engine.runRenderLoop(() => this.render());
  }

  initEngine() {
    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color3(0.6, 0.6, 0.6);

    // Camera
    this.camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -400), this.scene);
    this.camera.fov = 55 * TO_RADIANS;
    this.camera.minZ = 1;
    this.camera.maxZ = 10000;
    this.camera.setTarget(new BABYLON.Vector3(0, 0, 0));
    this.camera.detachControl();

    // Ambient
    this.scene.ambientColor = new BABYLON.Color3(0.133, 0.133, 0.133);

    // Hemisphere light
    const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.4;
    hemiLight.groundColor = new BABYLON.Color3(0.133, 0.133, 0.133);

    // Directional light
    const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(1, 1, -2).normalize(), this.scene);
    dirLight.intensity = 0.6;

    // Animation manager
    this.animationManager = new AnimationManager();

    // Texture cache
    this.textureCache = new TextureCache(50);

    // Handle resize
    window.addEventListener('resize', () => this.engine.resize());
  }

  initMaterials() {
    // Branch material
    this.branchMaterial = new BABYLON.StandardMaterial('branchMat', this.scene);
    const branchTexture = new BABYLON.Texture('/textures/beanstalk/branch.webp', this.scene);
    branchTexture.hasAlpha = true;
    this.branchMaterial.diffuseTexture = branchTexture;
    this.branchMaterial.diffuseColor = new BABYLON.Color3(0.133, 0.6, 0.255);
    this.branchMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    this.branchMaterial.specularPower = 10;
    this.branchMaterial.ambientColor = new BABYLON.Color3(0.133, 0.6, 0.255);
    this.branchMaterial.backFaceCulling = false;

    // Leaf material
    this.leafMaterial = new BABYLON.StandardMaterial('leafMat', this.scene);
    const leafTexture = new BABYLON.Texture('/textures/beanstalk/leaf.webp', this.scene);
    this.leafMaterial.diffuseTexture = leafTexture;
    this.leafMaterial.diffuseColor = new BABYLON.Color3(0.322, 0.663, 0.388);
    this.leafMaterial.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    this.leafMaterial.specularPower = 100;
    this.leafMaterial.ambientColor = new BABYLON.Color3(0.408, 0.871, 0.396);
    this.leafMaterial.backFaceCulling = false;
  }

  initObjects() {
    // Sky dome
    this.skyDome = new BABYLON.PhotoDome(
      'sky',
      '/textures/beanstalk/sunny-panorama.webp',
      { resolution: 32, size: 10000, useDirectMapping: false },
      this.scene
    );

    // Plant
    this.plant = new BeanstalkPlant(this.scene, this.branchMaterial, 30);
    this.plant.mesh.rotation.x = -90 * TO_RADIANS;
    this.plant.build();

    // Leaf template meshes
    this.leafStalkMesh = createLeafMesh(this.scene, LeafData.stalk, this.branchMaterial, 'leafStalkTemplate');
    this.leafStalkMesh.setEnabled(false);

    this.leafBladeMesh = createLeafMesh(this.scene, LeafData.leaf, this.leafMaterial, 'leafBladeTemplate');
    this.leafBladeMesh.setEnabled(false);

    // Branch pool
    this.branchPool = new ObjectPool();
    this.branchPool.createObject = () => this.createBranch();

    // Game case pool
    this.gameCasePool = new ObjectPool();
    this.gameCasePool.createObject = () => new GameCase3D(this.scene, this.textureCache);
  }

  createBranch() {
    const branch = this.leafStalkMesh.clone('branch' + this.branchPool.pool.length);
    branch.setEnabled(true);
    branch.material = this.branchMaterial;

    const leafMesh = this.leafBladeMesh.clone('leaf' + this.branchPool.pool.length);
    leafMesh.setEnabled(true);
    leafMesh.material = this.leafMaterial;
    leafMesh.parent = branch;
    leafMesh.position = new BABYLON.Vector3(53, 55, 0);
    leafMesh.rotation = new BABYLON.Vector3(0.1, 0, 0);
    leafMesh.scaling = new BABYLON.Vector3(3.5, 3.5, 3.5);

    return branch;
  }

  initInput() {
    this.input = new BeanstalkInput(this.canvas, {
      onGameSelect: (metadata) => {
        if (metadata.collectionItem) {
          this.onGameSelect(metadata.gameIndex);
          if (this.effects) {
            this.effects.highlightGame(metadata.gameData ?
              this.gameCases.find(c => c.gameIndex === metadata.gameIndex)?.position :
              new BABYLON.Vector3(0, 0, 0));
          }
        }
      }
    });
    this.input.setScene(this.scene);
  }

  initEffects() {
    this.effects = new BeanstalkEffects(this.scene);
    this.effects.init(this.plant.mesh);
  }

  initStartAnim() {
    // Position plant below view
    this.plant.position.z = 0;
    this.plant.position.y = -2000;

    // Animate plant entrance
    const plantTween = new Tween(this.plant.position, this.animationManager)
      .to({ z: 0, y: -300 }, 5000)
      .easing(Easing.Sinusoidal.EaseOut)
      .start();

    // Camera sway animation
    const cameraTween = new Tween(this.camera.position, this.animationManager)
      .to({ x: 50 }, 12000)
      .easing(Easing.Sinusoidal.EaseInOut)
      .start();

    const cameraTweenBack = new Tween(this.camera.position, this.animationManager)
      .to({ x: -50 }, 12000)
      .easing(Easing.Sinusoidal.EaseInOut);

    cameraTween.chain(cameraTweenBack);
    cameraTweenBack.chain(cameraTween);

    // Pre-populate some leaves
    this.prePopulateLeaves();
  }

  prePopulateLeaves() {
    const numRings = this.plant.ring.length;
    for (let ringIndex = 4; ringIndex < numRings - 4; ringIndex += 12 + Math.floor(Math.random() * 7)) {
      this.spawnLeaf(ringIndex, true);
    }
    this.branches.sort((a, b) => a.ringIndex - b.ringIndex);
  }

  spawnLeaf(ringIndex, prePopulate = false) {
    const branch = this.branchPool.getObject();
    branch.setEnabled(true);
    branch.getChildMeshes().forEach(child => child.setEnabled(true));

    const targetRingIndex = ringIndex !== undefined ? ringIndex : this.plant.ring.length - 1;
    branch.ringIndex = targetRingIndex;

    const facingLeft = this.swap;
    this.swap = !this.swap;
    branch.facingLeft = facingLeft;
    branch.ringPoint = facingLeft ? 4 : 6;

    const ringPos = this.plant.ring[Math.floor(targetRingIndex)][branch.ringPoint];
    branch.position.copyFrom(ringPos);

    if (prePopulate) {
      const scale = 0.5 + Math.random() * 0.2;
      branch.scaling.set(scale, scale, scale);
    } else {
      branch.scaling.set(0.01, 0.01, 0.01);
    }

    branch.rotation.x = 0;
    branch.rotation.y = facingLeft ? 180 * TO_RADIANS : 0;
    branch.rotation.z = -15 * TO_RADIANS;

    this.plant.addChild(branch);
    this.branches.push(branch);

    // Spawn game case on this leaf if we have data
    this.spawnGameCaseOnLeaf(branch);
  }

  spawnGameCaseOnLeaf(branch) {
    // Calculate game index based on plant position and leaf position
    const gameIndex = this.calculateGameIndex(branch.ringIndex);

    if (gameIndex < 0 || gameIndex >= this.totalCount) {
      return;
    }

    const item = this.items[gameIndex];
    const game = item ? this.games[item.gameId] : null;

    if (!item) {
      // Request data for this range
      this.onRequestData(gameIndex);
      return;
    }

    // Get or create game case
    const gameCase = this.gameCasePool.getObject();
    gameCase.setEnabled(true);
    gameCase.setGame(game, item, gameIndex);

    // Position in world space (not as child of branch)
    // Get the leaf's world position and offset from there
    const worldPos = branch.getAbsolutePosition();
    const offset = branch.facingLeft ? -120 : 120;
    gameCase.mesh.position.x = worldPos.x + offset;
    gameCase.mesh.position.y = worldPos.y;
    gameCase.mesh.position.z = worldPos.z - 30; // Toward camera (negative Z is toward camera)

    // Scale up significantly for visibility
    gameCase.mesh.scaling.set(4, 4, 4);

    // Don't parent to branch - keep in world space for correct billboard rotation

    // Store reference
    branch.gameCase = gameCase;
    this.gameCases.push(gameCase);
  }

  calculateGameIndex(ringIndex) {
    // Map ring position to game index
    // Lower ring indices = earlier games, tip = latest games
    const normalizedPosition = ringIndex / this.plant.ring.length;
    return Math.floor((1 - normalizedPosition) * this.totalCount + this.gamePositionOffset);
  }

  render() {
    const climbVelocity = this.input.update();

    // Spawn leaves when climbing
    if (climbVelocity > 0.1) {
      this.spawnCounter++;
      if (this.spawnCounter >= 50) {
        this.spawnCounter = 0;
        this.spawnLeaf();
      }
    }

    // Animation delta
    this.delta += 0.025 + 0.02 * Math.abs(climbVelocity);

    // Move plant (creates climbing illusion)
    this.plant.position.y -= climbVelocity * 6;
    this.plant.position.y = Math.max(Math.min(this.plant.position.y, -300), -1000);

    // Update game position offset based on plant movement
    this.gamePositionOffset += climbVelocity * 0.05;

    // Update plant ring positions
    for (let ringIndex = 0; ringIndex < this.plant.ringOrigin.length; ringIndex++) {
      for (let vertexIndex = 0; vertexIndex < this.plant.ringOrigin[ringIndex].length; vertexIndex++) {
        const pos = this.plant.ringOrigin[ringIndex][vertexIndex].clone();

        if (ringIndex === this.plant.ringOrigin.length - 1) {
          // Tip - sinusoidal spiral
          this.plant.offsetPoints[ringIndex] = new BABYLON.Vector3(
            70 * Math.cos(this.delta * 0.5) + 20 * Math.cos(this.delta * 2),
            70 * Math.sin(this.delta * 0.5) + 20 * Math.sin(this.delta * 2),
            0
          );
        } else {
          // Body - cascade from tip
          this.plant.offsetPoints[ringIndex] = this.plant.offsetPoints[ringIndex + 1];
        }

        pos.addInPlace(this.plant.offsetPoints[ringIndex]);
        this.plant.ring[ringIndex][vertexIndex].copyFrom(pos);
      }
    }

    this.plant.updateVertices();

    // Update leaves
    for (let leafIndex = 0; leafIndex < this.branches.length; leafIndex++) {
      const leaf = this.branches[leafIndex];
      leaf.ringIndex -= climbVelocity * 0.1;

      const ringIdx = Math.floor(leaf.ringIndex);
      const ringPoint = leaf.ringPoint || 0;

      if (ringIdx >= 0 && ringIdx < this.plant.ring.length) {
        const ringPos = this.plant.ring[ringIdx][ringPoint];
        const frac = leaf.ringIndex - ringIdx;

        if (ringIdx + 1 < this.plant.ring.length) {
          const nextRingPos = this.plant.ring[ringIdx + 1][ringPoint];
          leaf.position.x = ringPos.x + (nextRingPos.x - ringPos.x) * frac;
          leaf.position.y = ringPos.y + (nextRingPos.y - ringPos.y) * frac;
          leaf.position.z = ringPos.z + (nextRingPos.z - ringPos.z) * frac;
        } else {
          leaf.position.copyFrom(ringPos);
        }
      }

      // Grow leaves
      const maxScale = 0.7;
      if (leaf.scaling.x < maxScale) {
        const newScale = Math.min(leaf.scaling.x + 0.008 * Math.max(climbVelocity, 0), maxScale);
        leaf.scaling.set(newScale, newScale, newScale);
      }

      // Update game case position to follow the leaf
      if (leaf.gameCase) {
        const worldPos = leaf.getAbsolutePosition();
        const offset = leaf.facingLeft ? -120 : 120;
        leaf.gameCase.mesh.position.x = worldPos.x + offset;
        leaf.gameCase.mesh.position.y = worldPos.y;
        leaf.gameCase.mesh.position.z = worldPos.z - 30;
      }
    }

    // Update game case billboards
    const cameraPos = this.camera.position;
    for (const gameCase of this.gameCases) {
      if (gameCase.mesh.isEnabled()) {
        gameCase.updateBillboard(cameraPos);
      }
    }

    // Remove leaves past plant base
    while (this.branches.length > 0 && this.branches[0].ringIndex < 0) {
      const oldBranch = this.branches.shift();
      this.plant.removeChild(oldBranch);
      oldBranch.setEnabled(false);
      oldBranch.getChildMeshes().forEach(child => child.setEnabled(false));

      // Return game case to pool
      if (oldBranch.gameCase) {
        const caseIndex = this.gameCases.indexOf(oldBranch.gameCase);
        if (caseIndex > -1) {
          this.gameCases.splice(caseIndex, 1);
        }
        oldBranch.gameCase.setEnabled(false);
        oldBranch.gameCase.mesh.parent = null;
        this.gameCasePool.returnObject(oldBranch.gameCase.poolId);
        oldBranch.gameCase = null;
      }

      this.branchPool.returnObject(oldBranch.poolId);
    }

    // Sky rotation
    if (this.skyDome) {
      this.skyDome.rotation.y += 0.002;
    }

    // Update animations and effects
    this.animationManager.update();
    if (this.effects) {
      this.effects.update();
    }

    // Calculate and report visible range
    this.updateVisibleRange();

    // Render
    this.scene.render();
  }

  updateVisibleRange() {
    // Find min/max game indices currently visible
    let minIndex = Infinity;
    let maxIndex = -Infinity;

    for (const gameCase of this.gameCases) {
      if (gameCase.mesh.isEnabled() && gameCase.gameIndex >= 0) {
        minIndex = Math.min(minIndex, gameCase.gameIndex);
        maxIndex = Math.max(maxIndex, gameCase.gameIndex);
      }
    }

    if (minIndex !== Infinity && maxIndex !== -Infinity) {
      this.onVisibleRangeChange(minIndex, maxIndex);
    }
  }

  /**
   * Update data from Mithril component
   */
  setData(items, games, totalCount) {
    this.items = items;
    this.games = games;
    this.totalCount = totalCount;

    // Update existing game cases with new data
    for (const gameCase of this.gameCases) {
      if (gameCase.gameIndex >= 0 && gameCase.gameIndex < items.length) {
        const item = items[gameCase.gameIndex];
        const game = item ? games[item.gameId] : null;
        if (item && game !== gameCase.gameData) {
          gameCase.setGame(game, item, gameCase.gameIndex);
        }
      }
    }
  }

  dispose() {
    if (this.input) {
      this.input.dispose();
    }
    if (this.effects) {
      this.effects.dispose();
    }
    if (this.branchPool) {
      this.branchPool.dispose();
    }
    if (this.gameCasePool) {
      this.gameCasePool.dispose();
    }
    if (this.textureCache) {
      this.textureCache.dispose();
    }
    if (this.plant) {
      this.plant.dispose();
    }
    if (this.engine) {
      this.engine.dispose();
    }
  }
}
