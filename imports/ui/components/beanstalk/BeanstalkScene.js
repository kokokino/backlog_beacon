/**
 * BeanstalkScene.js - Scene setup: engine, camera, lighting, sky
 */

import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { BeanstalkPlant } from './BeanstalkPlant.js';
import { LeafData, createLeafMesh } from './LeafData.js';
import { ObjectPool, TextureCache, AnimationManager, Tween, Easing } from './BeanstalkPool.js';
import { GameCase3D, getCoverUrl } from './GameCase3D.js';
import { getPreloadUrls } from '../../lib/coverUrls.js';
import { BeanstalkInput } from './BeanstalkInput.js';
import { BeanstalkEffects } from './BeanstalkEffects.js';
import { showToast } from '../../lib/toast.js';

const TO_RADIANS = Math.PI / 180;
const MIN_LEAF_SPACING = 4; //12; // Minimum ring indices between leaves on same side

export class BeanstalkScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.onGameSelect = options.onGameSelect || (() => {});
    this.onVisibleRangeChange = options.onVisibleRangeChange || (() => {});
    this.onRequestData = options.onRequestData || (() => {});
    this.onRoosterVisibilityChange = options.onRoosterVisibilityChange || (() => {});

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
    this.lastFrameTime = 0;
    this.spawnCounter = 0;
    this.swap = false;

    // Input
    this.input = null;

    // Effects
    this.effects = null;

    // Data bridge (game is embedded in each item as item.game)
    this.items = [];
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

    // Rooster at top
    this.rooster = null;
    this.roosterAnimations = null;
    this.roosterVisible = false;
    this.roosterAnimInterval = null;

    // Initialize
    this.init();
  }

  async init() {
    this.initEngine();
    this.initMaterials();
    this.initObjects();
    this.initInput();
    this.initEffects();
    await this.initRooster();
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

    // Camera - initial distance will be set by updateCameraForViewport()
    this.camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -400), this.scene);
    this.camera.fov = 55 * TO_RADIANS;
    this.camera.minZ = 1;
    this.camera.maxZ = 10000;
    this.camera.setTarget(new BABYLON.Vector3(0, 0, 0));
    this.camera.detachControl();

    // Set initial camera distance based on viewport
    this.updateCameraForViewport();

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

    // Texture cache with placeholders
    this.textureCache = new TextureCache(50);
    this.textureCache.initPlaceholders(this.scene);

    // Handle resize
    this.onResize = () => {
      this.engine.resize();
      this.updateCameraForViewport();
    };
    window.addEventListener('resize', this.onResize);
  }

  updateCameraForViewport() {
    const aspectRatio = this.engine.getRenderWidth() / this.engine.getRenderHeight();
    const fovRadians = this.camera.fov;
    const tanHalfFov = Math.tan(fovRadians / 2);

    let targetDistance;

    if (aspectRatio < 1) {
      // Portrait: ensure horizontal width shows games + sway
      const requiredWidth = 500; // games at ±120 + sway ±90 + padding
      targetDistance = (requiredWidth / 2) / (aspectRatio * tanHalfFov);
    } else {
      // Landscape: ensure vertical height shows 4-5 games
      const requiredHeight = 500; // ~5 games worth of vertical space
      targetDistance = (requiredHeight / 2) / tanHalfFov;
    }

    // Clamp to reasonable range
    targetDistance = Math.max(300, Math.min(1200, targetDistance));

    this.camera.position.z = -targetDistance;
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
        if (metadata.gameIndex >= 0) {
          if (metadata.collectionItem) {
            this.onGameSelect(metadata.gameIndex);
          } else {
            // Data not loaded yet - show toast
            showToast('Loading game...');
          }
        }
      },
      onPanStart: () => this.stopCameraSway()
    });
    this.input.setScene(this.scene);
    this.input.setCamera(this.camera);
  }

  initEffects() {
    this.effects = new BeanstalkEffects(this.scene);
    this.effects.init(this.plant.mesh);
  }

  async initRooster() {
    const result = await BABYLON.SceneLoader.ImportMeshAsync(
      '',
      '/models/',
      'rooster.glb',
      this.scene
    );

    this.rooster = result.meshes[0];
    this.roosterAnimations = result.animationGroups;

    // Initial setup - hidden, scaled, positioned
    this.rooster.setEnabled(false);
    this.rooster.scaling.setAll(60);
    this.rooster.parent = this.plant.mesh;

    // Make rooster unlit so colors show fully
    for (const mesh of result.meshes) {
      if (mesh.material) {
        mesh.material.unlit = true;
      }
    }

    // Create dirt mound to hide stalk ring transitions
    this.roosterDirt = BABYLON.MeshBuilder.CreateCylinder('roosterDirt', {
      height: 30,
      diameterTop: 35,
      diameterBottom: 50,
      tessellation: 12
    }, this.scene);
    const dirtMaterial = new BABYLON.StandardMaterial('dirtMaterial', this.scene);
    dirtMaterial.diffuseColor = new BABYLON.Color3(0.45, 0.3, 0.15);
    dirtMaterial.emissiveColor = new BABYLON.Color3(0.25, 0.15, 0.08);
    this.roosterDirt.material = dirtMaterial;
    this.roosterDirt.parent = this.plant.mesh;
    this.roosterDirt.setEnabled(false);

    // Stop all animations initially
    this.roosterAnimations.forEach(anim => anim.stop());
  }

  showRooster() {
    if (!this.rooster || this.roosterVisible) {
      return;
    }

    this.rooster.setEnabled(true);
    if (this.roosterDirt) {
      this.roosterDirt.setEnabled(true);
    }
    this.roosterVisible = true;
    this.onRoosterVisibilityChange(true);

    if (this.roosterAnimations && this.roosterAnimations.length > 0) {
      // Find eat animation
      const eatAnim = this.roosterAnimations.find(anim =>
        anim.name.toLowerCase().includes('eat')
      );

      // Get skeleton for rest pose
      const skeleton = this.scene.skeletons[0];

      // Helper to set default standing pose
      const setStandingPose = () => {
        this.roosterAnimations.forEach(anim => anim.stop());
        if (skeleton) {
          skeleton.returnToRest();
        }
      };

      // Alternate between standing and eating every 3 seconds
      let isEating = false;
      const toggleEating = () => {
        isEating = !isEating;
        if (isEating && eatAnim) {
          eatAnim.play(true);
        } else {
          setStandingPose();
        }
      };

      // Start with default standing pose
      setStandingPose();

      this.roosterAnimInterval = setInterval(toggleEating, 3000);
    }
  }

  hideRooster() {
    if (!this.rooster || !this.roosterVisible) {
      return;
    }

    this.rooster.setEnabled(false);
    if (this.roosterDirt) {
      this.roosterDirt.setEnabled(false);
    }
    this.roosterVisible = false;
    this.onRoosterVisibilityChange(false);

    if (this.roosterAnimInterval) {
      clearInterval(this.roosterAnimInterval);
      this.roosterAnimInterval = null;
    }

    if (this.roosterAnimations) {
      this.roosterAnimations.forEach(anim => anim.stop());
    }
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

    // Camera sway animation (stored so it can be stopped when user pans)
    this.cameraTween = new Tween(this.camera.position, this.animationManager)
      .to({ x: 50 }, 12000)
      .easing(Easing.Sinusoidal.EaseInOut)
      .start();

    this.cameraTweenBack = new Tween(this.camera.position, this.animationManager)
      .to({ x: -50 }, 12000)
      .easing(Easing.Sinusoidal.EaseInOut);

    this.cameraTween.chain(this.cameraTweenBack);
    this.cameraTweenBack.chain(this.cameraTween);

    // Pre-populate some leaves
    this.prePopulateLeaves();
  }

  stopCameraSway() {
    if (this.cameraTween) {
      this.cameraTween.stop();
      this.cameraTween = null;
    }
    if (this.cameraTweenBack) {
      this.cameraTweenBack.stop();
      this.cameraTweenBack = null;
    }
  }

  prePopulateLeaves() {
    const numRings = this.plant.ring.length;

    // Phase 1: Create leaves without game cases
    // Start at ring 40 so first game is visible in viewport on load
    for (let ringIndex = 40; ringIndex < numRings - 4; ringIndex += 4 + Math.floor(Math.random() * 3)) {
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
    // Add some variation to spawn position for natural spacing
    const baseRing = ringIndex !== undefined ? ringIndex : this.plant.ring.length - 5;
    const targetRingIndex = baseRing + Math.floor(Math.random() * 4);

    const facingLeft = this.swap;

    // Check spacing from existing leaves to avoid overlap
    for (const branch of this.branches) {
      if (branch.facingLeft === facingLeft && Math.abs(branch.ringIndex - targetRingIndex) < MIN_LEAF_SPACING) {
        return; // Too close to existing leaf on same side
      }
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
    const game = item ? item.game : null;

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

    const facingLeft = this.swap;

    // Check spacing from existing leaves to avoid overlap
    for (const branch of this.branches) {
      if (branch.facingLeft === facingLeft && Math.abs(branch.ringIndex - targetRingIndex) < MIN_LEAF_SPACING) {
        return; // Too close to existing leaf on same side
      }
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
    // Calculate time-based delta for frame-rate independent animations
    const now = performance.now();
    const deltaTime = Math.min(this.lastFrameTime > 0 ? now - this.lastFrameTime : 16.67, 100);
    this.lastFrameTime = now;

    let climbVelocity = this.input.update();

    // Clamp velocity when at game 0 to prevent scrolling past start
    // Allow first game to reach middle of viewport before stopping
    if (this.minGameIndex <= 0 && climbVelocity < 0) {
      const lowestLeaf = this.branches[0];
      // Allow scrolling until the first game reaches ~45% up the plant (keeps it in viewport)
      const middleThreshold = Math.floor(this.plant.ring.length * 0.45);
      if (lowestLeaf && lowestLeaf.ringIndex >= middleThreshold) {
        climbVelocity = Math.max(climbVelocity, 0);
      }
    }

    // Clamp velocity when at last game to prevent scrolling past end
    // Allow last game to scroll down so rooster is fully visible
    if (this.nextGameIndex >= this.totalCount && this.totalCount > 0 && climbVelocity > 0) {
      const highestLeaf = this.branches[this.branches.length - 1];
      // Allow scrolling until the last game reaches ~38% up the plant (rooster visible above)
      const middleThreshold = Math.floor(this.plant.ring.length * 0.38);
      if (highestLeaf && highestLeaf.ringIndex <= middleThreshold) {
        climbVelocity = Math.min(climbVelocity, 0);
      }
    }

    // Spawn leaves when climbing UP - only if we have more games
    if (climbVelocity > 0.1 && this.nextGameIndex < this.totalCount) {
      // Increment counter by velocity (minimum 1) for faster spawning when scrolling fast (normalized to 60fps)
      this.spawnCounter += Math.max(1, Math.abs(climbVelocity)) * 60 * deltaTime / 1000;
      // Allow multiple spawns per frame if scrolling very fast
      while (this.spawnCounter >= 10 && this.nextGameIndex < this.totalCount) {
        this.spawnCounter -= 10;
        this.spawnLeaf();
      }
    }

    // Spawn leaves when scrolling DOWN (only if we have lower games to show)
    if (climbVelocity < -0.1 && this.minGameIndex > 0) {
      // Increment counter by velocity (minimum 1) for faster spawning when scrolling fast (normalized to 60fps)
      this.spawnCounterDown += Math.max(1, Math.abs(climbVelocity)) * 60 * deltaTime / 1000;
      // Allow multiple spawns per frame if scrolling very fast
      while (this.spawnCounterDown >= 10 && this.minGameIndex > 0) {
        this.spawnCounterDown -= 10;
        this.spawnLeafAtBottom();
      }
    }

    // Animation delta (time-based for frame-rate independence)
    const deltaPerSecond = 1.5 + 1.2 * Math.abs(climbVelocity);
    this.delta += deltaPerSecond * (deltaTime / 1000);

    // Move plant (creates climbing illusion, normalized to 60fps)
    this.plant.position.y -= climbVelocity * 6 * 60 * deltaTime / 1000;
    this.plant.position.y = Math.max(Math.min(this.plant.position.y, -300), -1000);

    // Update plant ring positions (time-based wave, no frame-rate dependent cascade)
    const numRings = this.plant.ringOrigin.length;
    for (let ringIndex = 0; ringIndex < numRings; ringIndex++) {
      // Calculate phase delay based on distance from tip (creates traveling wave effect)
      const distanceFromTip = numRings - 1 - ringIndex;
      const phaseDelay = distanceFromTip * 0.025;
      const phase = this.delta - phaseDelay;

      // Amplitude dampens toward base for organic feel
      const dampFactor = 1 - (distanceFromTip / numRings) * 0.3;

      this.plant.offsetPoints[ringIndex] = new BABYLON.Vector3(
        dampFactor * (70 * Math.cos(phase * 0.5) + 20 * Math.cos(phase * 2)),
        dampFactor * (70 * Math.sin(phase * 0.5) + 20 * Math.sin(phase * 2)),
        0
      );

      for (let vertexIndex = 0; vertexIndex < this.plant.ringOrigin[ringIndex].length; vertexIndex++) {
        this._tempPos.copyFrom(this.plant.ringOrigin[ringIndex][vertexIndex]);
        this._tempPos.addInPlace(this.plant.offsetPoints[ringIndex]);
        this.plant.ring[ringIndex][vertexIndex].copyFrom(this._tempPos);
      }
    }

    // Cut the stalk and position rooster on top when visible
    if (this.rooster && this.roosterVisible && this.branches.length > 0) {
      const highestLeaf = this.branches[this.branches.length - 1];
      const leafRingIdx = Math.min(
        Math.floor(highestLeaf.ringIndex),
        this.plant.ring.length - 1
      );

      // Get stalk center at this ring (0,0 + animation offset)
      const stalkCenterX = this.plant.offsetPoints[leafRingIdx].x;
      const stalkCenterY = this.plant.offsetPoints[leafRingIdx].y;

      // Position dirt mound to hide ring transitions
      const dirtOffset = 20;
      if (this.roosterDirt) {
        this.roosterDirt.position.x = stalkCenterX;
        this.roosterDirt.position.y = stalkCenterY;
        this.roosterDirt.position.z = highestLeaf.position.z + dirtOffset;
        // Rotate so cylinder points along Z axis (stalk direction)
        this.roosterDirt.rotation.x = 90 * TO_RADIANS;
      }

      // Position rooster on top of dirt (dirt height is 30, so top is at dirtOffset + 15)
      // Offset rooster slightly right (positive X) since it faces left
      this.rooster.position.x = stalkCenterX + 12;
      this.rooster.position.y = stalkCenterY;
      this.rooster.position.z = highestLeaf.position.z + dirtOffset + 15;
      this.rooster.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(
        0,
        -90 * TO_RADIANS,
        -90 * TO_RADIANS
      );

      // Set collapse point for rings above rooster (handled in updateVertices)
      this.plant.collapseAboveRing = Math.floor(highestLeaf.ringIndex) + 2;
      this.plant.collapsePoint = this.roosterDirt ? this.roosterDirt.position : this.rooster.position;
    } else {
      this.plant.collapseAboveRing = null;
      this.plant.collapsePoint = null;
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
      // When scrolling down: start at ring 25 (below viewport) so leaves grow before entering
      // When scrolling up: start at ring 85 (top of viewport) so leaves grow as they enter
      if (!leaf.growthEnabled && leaf.ringIndex >= 25 && leaf.ringIndex <= 85) {
        leaf.inViewport = true;
        leaf.growthEnabled = true;
      }

      // Grow leaves only when growth is enabled (use absolute velocity so they grow in both directions)
      const maxScale = 0.7;
      if (leaf.growthEnabled && leaf.scaling.x < maxScale) {
        const growthRate = 0.008 * Math.abs(climbVelocity) * 60 * deltaTime / 1000;
        const newScale = Math.min(leaf.scaling.x + growthRate, maxScale);
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

    // Show rooster when at the last game
    const shouldShowRooster = this.nextGameIndex >= this.totalCount && this.totalCount > 0;

    if (shouldShowRooster && !this.roosterVisible) {
      this.showRooster();
    }

    if (!shouldShowRooster && this.roosterVisible) {
      this.hideRooster();
    }

    // Sky rotation (normalized to 60fps)
    if (this.skyDome) {
      this.skyDome.rotation.y += 0.002 * 60 * deltaTime / 1000;
    }

    // Update animations and effects
    this.animationManager.update();
    if (this.effects) {
      this.effects.update();
    }

    // Calculate and report visible range
    this.updateVisibleRange();

    // Preload textures based on velocity
    this._preloadTexturesForVelocity(climbVelocity);

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
    return ringIndex >= 35 && ringIndex <= 95;
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
   * Preload textures for games ahead of the current scroll position
   * Lookahead increases with velocity for smoother fast scrolling
   *
   * @param {number} velocity - Current climb velocity (positive = up, negative = down)
   */
  _preloadTexturesForVelocity(velocity) {
    if (this.totalCount === 0) {
      return;
    }

    // Base lookahead of 20 games, multiplied by velocity factor
    const baseLookahead = 20;
    const velocityMultiplier = Math.min(3, 1 + Math.abs(velocity) / 2);
    const lookahead = Math.round(baseLookahead * velocityMultiplier);

    // Calculate range to preload based on velocity direction
    let preloadStart;
    let preloadEnd;

    if (velocity > 0.1) {
      // Climbing up - preload more ahead (higher indices)
      preloadStart = this.nextGameIndex;
      preloadEnd = Math.min(this.totalCount - 1, this.nextGameIndex + lookahead);
    } else if (velocity < -0.1) {
      // Climbing down - preload more behind (lower indices)
      preloadStart = Math.max(0, this.minGameIndex - lookahead);
      preloadEnd = this.minGameIndex;
    } else {
      // Idle - preload in both directions
      const halfLookahead = Math.round(lookahead / 2);
      preloadStart = Math.max(0, this.minGameIndex - halfLookahead);
      preloadEnd = Math.min(this.totalCount - 1, this.nextGameIndex + halfLookahead);
    }

    // Collect URLs to preload
    const urls = [];
    for (let index = preloadStart; index <= preloadEnd; index++) {
      const item = this.items[index];
      if (item && item.game) {
        const gameUrls = getPreloadUrls(item.game);
        urls.push(...gameUrls);
      }
    }

    if (urls.length > 0) {
      this.textureCache.preloadTextures(urls, this.scene);
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
    for (let ringIndex = 40; ringIndex < numRings - 4; ringIndex += 4 + Math.floor(Math.random() * 3)) {
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

    // If at end of collection, move plant down to give rooster breathing room
    if (this.nextGameIndex >= this.totalCount) {
      this.plant.position.y = -500;
    }

    // Update tracking
    this.updateLeafTrackingFromBranches();
  }

  /**
   * Update data from Mithril component (game is embedded in each item as item.game)
   */
  setData(items, totalCount) {
    this.items = items;
    this.totalCount = totalCount;

    // Update existing game cases with new data
    for (const gameCase of this.gameCases) {
      if (gameCase.gameIndex >= 0 && gameCase.gameIndex < items.length) {
        const item = items[gameCase.gameIndex];
        const game = item ? item.game : null;
        // Update if: item exists AND (we didn't have collectionItem before OR game changed)
        if (item && (!gameCase.collectionItem || game !== gameCase.gameData)) {
          gameCase.setGame(game, item, gameCase.gameIndex);
        }
      }
    }
  }

  async disposeAsync() {
    // Stop render loop immediately to prevent rendering during disposal
    if (this.engine) {
      this.engine.stopRenderLoop();
    }

    // Remove resize listener
    if (this.onResize) {
      window.removeEventListener('resize', this.onResize);
      this.onResize = null;
    }

    // Immediate cleanup (non-blocking)
    if (this.input) {
      this.input.dispose();
    }
    if (this.effects) {
      this.effects.dispose();
    }
    if (this.roosterAnimInterval) {
      clearInterval(this.roosterAnimInterval);
    }
    if (this.rooster) {
      this.rooster.dispose();
    }
    if (this.roosterAnimations) {
      this.roosterAnimations.forEach(anim => anim.dispose());
    }

    // Chunked async disposal
    if (this.branchPool) {
      await this.branchPool.disposeAsync();
    }
    if (this.gameCasePool) {
      await this.gameCasePool.disposeAsync();
    }
    if (this.textureCache) {
      await this.textureCache.disposeAsync();
    }

    // Longer delay before heavy cleanup to let UI settle
    await new Promise(resolve => setTimeout(resolve, 100));

    // Final cleanup
    if (this.plant) {
      this.plant.dispose();
    }

    // Use requestIdleCallback for engine disposal (heaviest operation)
    // This only runs when browser is idle, minimizing UI impact
    await new Promise(resolve => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => resolve(), { timeout: 2000 });
      } else {
        setTimeout(resolve, 100);
      }
    });

    if (this.engine) {
      this.engine.dispose();
    }
  }
}
