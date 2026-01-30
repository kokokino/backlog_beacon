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
const MIN_LEAF_SPACING = 4; //12; // Minimum ring indices between leaves on same side

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
    this.nextGameIndex = 0;  // Next game to spawn at TOP
    this.minGameIndex = 0;   // Lowest game index currently displayed

    // Spawn counters for both directions
    this.spawnCounterDown = 0;

    // Track last leaf position on each side to prevent overlap
    this.lastLeftRingIndex = -Infinity;
    this.lastRightRingIndex = -Infinity;

    // Track lowest leaf position on each side for bottom spawning
    this.lowestLeftRingIndex = Infinity;
    this.lowestRightRingIndex = Infinity;

    // Reusable temp vector to avoid allocations in render loop
    this._tempPos = new BABYLON.Vector3();

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
    const cameraDistance = -400;
    this.camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, cameraDistance), this.scene);
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

    // Phase 1: Create leaves without game cases
    // Start at ring 20 so first game is visible in viewport on load
    for (let ringIndex = 20; ringIndex < numRings - 4; ringIndex += 4 + Math.floor(Math.random() * 3)) {
      this.spawnLeafOnly(ringIndex);
    }

    // Phase 2: Sort by ring index (bottom = lowest index)
    this.branches.sort((a, b) => a.ringIndex - b.ringIndex);

    // Phase 3: Assign games sequentially from bottom to top
    for (const branch of this.branches) {
      this.spawnGameCaseOnLeaf(branch);
    }

    // Initialize minGameIndex to 0 (first game is at bottom)
    this.minGameIndex = 0;

    // Initialize tracking based on topmost leaves on each side
    this.updateLeafTrackingFromBranches();
  }

  updateLeafTrackingFromBranches() {
    // Reset tracking
    this.lastLeftRingIndex = -Infinity;
    this.lastRightRingIndex = -Infinity;
    this.lowestLeftRingIndex = Infinity;
    this.lowestRightRingIndex = Infinity;

    // Find the topmost and lowest leaf on each side
    for (const branch of this.branches) {
      if (branch.facingLeft) {
        this.lastLeftRingIndex = Math.max(this.lastLeftRingIndex, branch.ringIndex);
        this.lowestLeftRingIndex = Math.min(this.lowestLeftRingIndex, branch.ringIndex);
      } else {
        this.lastRightRingIndex = Math.max(this.lastRightRingIndex, branch.ringIndex);
        this.lowestRightRingIndex = Math.min(this.lowestRightRingIndex, branch.ringIndex);
      }
    }
  }

  spawnLeafOnly(ringIndex) {
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

    const scale = 0.5 + Math.random() * 0.2;
    branch.scaling.set(scale, scale, scale);

    branch.rotation.x = 0;
    branch.rotation.y = facingLeft ? 180 * TO_RADIANS : 0;
    branch.rotation.z = -15 * TO_RADIANS;

    // Pre-populated leaves are already at full scale, so enable growth
    branch.inViewport = true;
    branch.growthEnabled = true;

    this.plant.addChild(branch);
    this.branches.push(branch);
  }

  spawnLeaf(ringIndex, prePopulate = false) {
    const targetRingIndex = ringIndex !== undefined ? ringIndex : this.plant.ring.length - 1;

    // Check if we have enough spacing from the last leaf on this side
    const facingLeft = this.swap;
    const lastSameSideRingIndex = facingLeft ? this.lastLeftRingIndex : this.lastRightRingIndex;
    const spacing = targetRingIndex - lastSameSideRingIndex;

    if (spacing < MIN_LEAF_SPACING) {
      // Not enough space on this side, skip spawning
      return;
    }

    const branch = this.branchPool.getObject();
    branch.setEnabled(true);
    branch.getChildMeshes().forEach(child => child.setEnabled(true));

    branch.ringIndex = targetRingIndex;

    this.swap = !this.swap;
    branch.facingLeft = facingLeft;
    branch.ringPoint = facingLeft ? 4 : 6;

    // Update tracking for this side
    if (facingLeft) {
      this.lastLeftRingIndex = targetRingIndex;
    } else {
      this.lastRightRingIndex = targetRingIndex;
    }

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

    // New leaves wait for viewport before growing
    branch.inViewport = false;
    branch.growthEnabled = false;

    this.plant.addChild(branch);
    this.branches.push(branch);

    // Spawn game case on this leaf if we have data
    this.spawnGameCaseOnLeaf(branch);
  }

  spawnGameCaseOnLeaf(branch, gameIndex = null) {
    // Use provided gameIndex or default to nextGameIndex (for top spawning)
    const useGameIndex = gameIndex !== null ? gameIndex : this.nextGameIndex;

    // Don't check totalCount here - we want to create placeholder cases
    // even before data arrives. setData() will update them later.

    const item = this.items[useGameIndex];
    const game = item ? this.games[item.gameId] : null;

    // Request data if missing (but don't return - create placeholder case)
    if (!item) {
      this.onRequestData(useGameIndex);
    }

    // Always create game case - will show placeholder if no data yet
    const gameCase = this.gameCasePool.getObject();
    gameCase.setEnabled(true);
    gameCase.setGame(game, item, useGameIndex);

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
    branch.gameIndex = useGameIndex;
    this.gameCases.push(gameCase);

    // Update tracking indices only when using default top spawning
    if (gameIndex === null) {
      this.nextGameIndex++;
    }
  }

  spawnLeafAtBottom() {
    // Spawn a leaf at the bottom of the plant with a lower game index
    const targetGameIndex = this.minGameIndex - 1;
    if (targetGameIndex < 0) {
      return; // Can't go below game 0
    }

    // Spawn at a low ring index (near bottom of plant)
    const targetRingIndex = 4 + Math.floor(Math.random() * 5);

    // Check if we have enough spacing from the lowest leaf on this side
    const facingLeft = this.swap;

    // Use cached lowest ring index instead of O(n) loop
    const lowestSameSideRingIndex = facingLeft ? this.lowestLeftRingIndex : this.lowestRightRingIndex;

    const spacing = lowestSameSideRingIndex - targetRingIndex;
    if (spacing < MIN_LEAF_SPACING) {
      // Not enough space on this side, skip spawning
      return;
    }

    const branch = this.branchPool.getObject();
    branch.setEnabled(true);
    branch.getChildMeshes().forEach(child => child.setEnabled(true));

    branch.ringIndex = targetRingIndex;

    this.swap = !this.swap;
    branch.facingLeft = facingLeft;
    branch.ringPoint = facingLeft ? 4 : 6;

    const ringPos = this.plant.ring[Math.floor(targetRingIndex)][branch.ringPoint];
    branch.position.copyFrom(ringPos);

    // Start small and grow
    branch.scaling.set(0.01, 0.01, 0.01);

    branch.rotation.x = 0;
    branch.rotation.y = facingLeft ? 180 * TO_RADIANS : 0;
    branch.rotation.z = -15 * TO_RADIANS;

    // New leaves wait for viewport before growing
    branch.inViewport = false;
    branch.growthEnabled = false;

    this.plant.addChild(branch);

    // Insert at beginning of branches array (sorted by ring index, bottom first)
    this.branches.unshift(branch);

    // Update cached lowest ring index for this side
    if (facingLeft) {
      this.lowestLeftRingIndex = Math.min(this.lowestLeftRingIndex, targetRingIndex);
    } else {
      this.lowestRightRingIndex = Math.min(this.lowestRightRingIndex, targetRingIndex);
    }

    // Spawn game case with the lower game index
    this.spawnGameCaseOnLeaf(branch, targetGameIndex);

    // Update minGameIndex
    this.minGameIndex = targetGameIndex;
  }

  render() {
    let climbVelocity = this.input.update();

    // Clamp velocity when at game 0 to prevent scrolling past start
    // Allow first game to reach middle of viewport before stopping
    if (this.minGameIndex <= 0 && climbVelocity < 0) {
      const lowestLeaf = this.branches[0];
      // Allow scrolling until the first game reaches ~30% up the plant (keeps it in viewport)
      const middleThreshold = Math.floor(this.plant.ring.length * 0.2);
      if (lowestLeaf && lowestLeaf.ringIndex >= middleThreshold) {
        climbVelocity = Math.max(climbVelocity, 0);
      }
    }

    // Clamp velocity when at last game to prevent scrolling past end
    // Allow last game to reach middle of viewport before stopping
    if (this.nextGameIndex >= this.totalCount && this.totalCount > 0 && climbVelocity > 0) {
      const highestLeaf = this.branches[this.branches.length - 1];
      // Allow scrolling until the last game reaches ~60% up the plant (near viewport center)
      const middleThreshold = Math.floor(this.plant.ring.length * 0.6);
      if (highestLeaf && highestLeaf.ringIndex <= middleThreshold) {
        climbVelocity = Math.min(climbVelocity, 0);
      }
    }

    // Spawn leaves when climbing UP - only if we have more games
    if (climbVelocity > 0.1 && this.nextGameIndex < this.totalCount) {
      this.spawnCounter++;
      if (this.spawnCounter >= 20 /*50*/) {
        this.spawnCounter = 0;
        this.spawnLeaf();
      }
    }

    // Spawn leaves when scrolling DOWN (only if we have lower games to show)
    if (climbVelocity < -0.1 && this.minGameIndex > 0) {
      this.spawnCounterDown++;
      if (this.spawnCounterDown >= 20 /*50*/) {
        this.spawnCounterDown = 0;
        this.spawnLeafAtBottom();
      }
    }

    // Animation delta
    this.delta += 0.025 + 0.02 * Math.abs(climbVelocity);

    // Move plant (creates climbing illusion)
    this.plant.position.y -= climbVelocity * 6;
    this.plant.position.y = Math.max(Math.min(this.plant.position.y, -300), -1000);

    // Update plant ring positions
    for (let ringIndex = 0; ringIndex < this.plant.ringOrigin.length; ringIndex++) {
      for (let vertexIndex = 0; vertexIndex < this.plant.ringOrigin[ringIndex].length; vertexIndex++) {
        this._tempPos.copyFrom(this.plant.ringOrigin[ringIndex][vertexIndex]);

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

        this._tempPos.addInPlace(this.plant.offsetPoints[ringIndex]);
        this.plant.ring[ringIndex][vertexIndex].copyFrom(this._tempPos);
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

      // Check if leaf entered growth zone
      // When scrolling down: start at ring 5 (below viewport) so leaves grow before entering
      // When scrolling up: start at ring 75 (top of viewport) so leaves grow as they enter
      if (!leaf.growthEnabled && leaf.ringIndex >= 5 && leaf.ringIndex <= 65) {
        leaf.inViewport = true;
        leaf.growthEnabled = true;
      }

      // Grow leaves only when growth is enabled (use absolute velocity so they grow in both directions)
      const maxScale = 0.7;
      if (leaf.growthEnabled && leaf.scaling.x < maxScale) {
        const newScale = Math.min(leaf.scaling.x + 0.008 * Math.abs(climbVelocity), maxScale);
        leaf.scaling.set(newScale, newScale, newScale);
      }

      // Update game case position to follow the leaf
      // Offset scales with leaf growth - games start close to stalk and get "pushed out"
      if (leaf.gameCase) {
        const worldPos = leaf.getAbsolutePosition();
        const growthProgress = Math.min(leaf.scaling.x / maxScale, 1);
        const minOffset = 30;
        const maxOffset = 120;
        const currentOffset = minOffset + (maxOffset - minOffset) * growthProgress;
        const offset = leaf.facingLeft ? -currentOffset : currentOffset;
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

    // Remove leaves past plant base (when scrolling up)
    let removedAny = false;
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

      // Update minGameIndex to reflect what's still on screen
      if (this.branches.length > 0 && this.branches[0].gameIndex !== undefined) {
        this.minGameIndex = this.branches[0].gameIndex;
      }

      removedAny = true;
    }

    // Remove leaves past plant top (when scrolling down)
    while (this.branches.length > 0 &&
           this.branches[this.branches.length - 1].ringIndex >= this.plant.ring.length) {
      const oldBranch = this.branches.pop();
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

      // Update nextGameIndex to reflect what's still on screen
      if (this.branches.length > 0) {
        const topBranch = this.branches[this.branches.length - 1];
        if (topBranch.gameIndex !== undefined) {
          this.nextGameIndex = topBranch.gameIndex + 1;
        }
      }

      removedAny = true;
    }

    // Update leaf tracking once after all removals
    if (removedAny) {
      this.updateLeafTrackingFromBranches();
    }

    // Remove leaves above the last game when we've reached the end
    if (this.nextGameIndex >= this.totalCount && this.totalCount > 0) {
      for (let leafIndex = this.branches.length - 1; leafIndex >= 0; leafIndex--) {
        const branch = this.branches[leafIndex];
        // Remove leaves that have no game case (decorative leaves above last game)
        if (!branch.gameCase || branch.gameIndex >= this.totalCount) {
          this.branches.splice(leafIndex, 1);
          this.plant.removeChild(branch);
          branch.setEnabled(false);
          branch.getChildMeshes().forEach(child => child.setEnabled(false));

          if (branch.gameCase) {
            const caseIndex = this.gameCases.indexOf(branch.gameCase);
            if (caseIndex > -1) {
              this.gameCases.splice(caseIndex, 1);
            }
            branch.gameCase.setEnabled(false);
            this.gameCasePool.returnObject(branch.gameCase.poolId);
          }
          this.branchPool.returnObject(branch.poolId);
        }
      }
      this.updateLeafTrackingFromBranches();
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

    // Start fairy lights once any game is visible in viewport
    if (this.effects && !this.effects.fairyLightsActive) {
      for (const branch of this.branches) {
        if (branch.gameCase && this.isRingInViewport(branch.ringIndex)) {
          this.effects.startFairyLights();
          break;
        }
      }
    }

    // Render
    this.scene.render();
  }

  isRingInViewport(ringIndex) {
    return ringIndex >= 15 && ringIndex <= 75;
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
   * Jump to a specific game index by recycling leaves and respawning
   */
  scrollToIndex(targetIndex) {
    // Clamp target to valid range
    targetIndex = Math.max(0, Math.min(targetIndex, this.totalCount - 1));

    // Stop any momentum
    if (this.input) {
      this.input.setVelocity(0);
    }

    // Recycle all current leaves back to pool
    while (this.branches.length > 0) {
      const branch = this.branches.pop();
      this.plant.removeChild(branch);
      branch.setEnabled(false);
      branch.getChildMeshes().forEach(child => child.setEnabled(false));

      if (branch.gameCase) {
        const caseIndex = this.gameCases.indexOf(branch.gameCase);
        if (caseIndex > -1) {
          this.gameCases.splice(caseIndex, 1);
        }
        branch.gameCase.setEnabled(false);
        branch.gameCase.mesh.parent = null;
        this.gameCasePool.returnObject(branch.gameCase.poolId);
        branch.gameCase = null;
      }

      this.branchPool.returnObject(branch.poolId);
    }

    // Reset tracking state
    this.minGameIndex = targetIndex;
    this.nextGameIndex = targetIndex;
    this.lastLeftRingIndex = -Infinity;
    this.lastRightRingIndex = -Infinity;
    this.lowestLeftRingIndex = Infinity;
    this.lowestRightRingIndex = Infinity;
    this.swap = false;
    this.spawnCounter = 0;
    this.spawnCounterDown = 0;

    // Reset plant position
    this.plant.position.y = -300;

    // Spawn leaves around the target index
    const numRings = this.plant.ring.length;
    for (let ringIndex = 20; ringIndex < numRings - 4; ringIndex += 4 + Math.floor(Math.random() * 3)) {
      this.spawnLeafOnly(ringIndex);
    }

    // Sort by ring index
    this.branches.sort((a, b) => a.ringIndex - b.ringIndex);

    // Assign games sequentially starting from targetIndex
    for (const branch of this.branches) {
      const gameIndex = this.nextGameIndex;
      if (gameIndex < this.totalCount) {
        this.spawnGameCaseOnLeaf(branch, gameIndex);
        this.nextGameIndex = gameIndex + 1;
      }
    }

    // Update tracking
    this.updateLeafTrackingFromBranches();
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
