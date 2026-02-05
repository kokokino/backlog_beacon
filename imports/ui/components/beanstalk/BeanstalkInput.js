/**
 * BeanstalkInput.js - Scroll/drag/touch navigation with momentum physics
 */

// Climb physics (smooth momentum for natural touch feel)
const CLIMB_FRICTION = 0.96;
const CLIMB_MIN = -6.0;
const CLIMB_MAX = 6.0;
const SCROLL_SENSITIVITY = 0.03;
const DRAG_SENSITIVITY = 0.2;
const CLICK_MAX_DISTANCE = 10;    // pixels - max movement for a click
const CLICK_MAX_DURATION = 300;   // ms - max hold time for a click

// Touch-specific (2x mouse drag for touch)
const TOUCH_DRAG_SENSITIVITY = 0.4;

// Zoom
const ZOOM_SENSITIVITY = 0.5;         // Pinch distance to Z
const CTRL_ZOOM_SENSITIVITY = 0.5;    // Ctrl+wheel to Z
const ZOOM_MIN = -1500;               // Max zoom out
const ZOOM_MAX = -200;                // Max zoom in

// Pan
const PAN_SENSITIVITY = 0.2;          // Two-finger pan
const SHIFT_PAN_SENSITIVITY = 0.3;    // Shift+wheel pan
const PAN_MIN = -200;                 // Left limit
const PAN_MAX = 200;                  // Right limit

export class BeanstalkInput {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.onGameSelect = options.onGameSelect || (() => {});
    this.onVelocityChange = options.onVelocityChange || (() => {});
    this.onPanStart = options.onPanStart || (() => {});

    // Velocity state
    this.climbVelocity = 1.0;
    this.targetClimbVelocity = 1.0;
    this.lastUpdateTime = 0;

    // Drag state
    this.isDragging = false;
    this.lastDragY = 0;

    // Scene reference for raycasting
    this.scene = null;

    // Camera reference for zoom/pan
    this.camera = null;

    // Click detection state
    this.pointerStartX = 0;
    this.pointerStartY = 0;
    this.pointerStartTime = 0;
    this.hasMoved = false;

    // Multi-touch state
    this.pinchStartDistance = 0;
    this.lastPinchDistance = 0;
    this.isPinching = false;
    this.panStartX = 0;
    this.panStartCameraX = 0;
    this.isPanning = false;

    // Smooth camera pan/zoom targets
    this.targetCameraX = 0;
    this.targetCameraZ = null;  // null = not initialized yet

    // Bind methods
    this.onWheel = this.onWheel.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);

    this.setupEventListeners();
  }

  setScene(scene) {
    this.scene = scene;
  }

  setCamera(camera) {
    this.camera = camera;
  }

  setupEventListeners() {
    // Wheel for scrolling
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    // Pointer events for drag (works for mouse and touch)
    this.canvas.addEventListener('pointerdown', this.onPointerDown, false);
    this.canvas.addEventListener('pointermove', this.onPointerMove, false);
    this.canvas.addEventListener('pointerup', this.onPointerUp, false);
    this.canvas.addEventListener('pointerleave', this.onPointerUp, false);

    // Touch events for mobile
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: true });

    // Set initial cursor
    this.canvas.style.cursor = 'grab';
  }

  removeEventListeners() {
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerUp);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
  }

  onWheel(event) {
    event.preventDefault();

    if (event.ctrlKey && this.camera) {
      // Ctrl + wheel = zoom
      this.camera.position.z += event.deltaY * CTRL_ZOOM_SENSITIVITY;
      this.camera.position.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.camera.position.z));
      return;
    }

    if (event.shiftKey && this.camera) {
      // Shift + wheel = pan (browser puts scroll in deltaX when shift is held)
      // Initialize target from current position on first pan
      if (this.targetCameraX === 0 && this.camera.position.x !== 0) {
        this.targetCameraX = this.camera.position.x;
      }
      this.onPanStart();
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      this.targetCameraX += delta * SHIFT_PAN_SENSITIVITY;
      this.targetCameraX = Math.max(PAN_MIN, Math.min(PAN_MAX, this.targetCameraX));
      return;
    }

    // Normal scroll = climb velocity
    this.targetClimbVelocity -= event.deltaY * SCROLL_SENSITIVITY;
    this.clampTargetVelocity();
  }

  onPointerDown(event) {
    event.preventDefault();

    // Record start position and time for click detection
    this.pointerStartX = event.offsetX;
    this.pointerStartY = event.offsetY;
    this.pointerStartTime = Date.now();
    this.hasMoved = false;

    // Start drag tracking
    this.isDragging = true;
    this.lastDragY = event.clientY;
    this.canvas.style.cursor = 'grabbing';
    this.canvas.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.isDragging) {
      return;
    }
    event.preventDefault();

    // Check if movement exceeds click threshold
    if (!this.hasMoved) {
      const deltaX = event.offsetX - this.pointerStartX;
      const deltaY = event.offsetY - this.pointerStartY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance > CLICK_MAX_DISTANCE) {
        this.hasMoved = true;
      }
    }

    const deltaY = event.clientY - this.lastDragY;
    this.lastDragY = event.clientY;

    // Drag down = climb faster, drag up = slow/reverse
    this.targetClimbVelocity += deltaY * DRAG_SENSITIVITY;
    this.clampTargetVelocity();
  }

  onPointerUp(event) {
    const wasClick = !this.hasMoved &&
      (Date.now() - this.pointerStartTime) < CLICK_MAX_DURATION;

    // Check for game selection on click (not drag)
    if (wasClick && this.scene) {
      const pickResult = this.scene.pick(this.pointerStartX, this.pointerStartY);
      if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.metadata?.gameIndex >= 0) {
        this.onGameSelect(pickResult.pickedMesh.metadata);
      }
    }

    if (this.isDragging && event.pointerId !== undefined) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.isDragging = false;
    this.canvas.style.cursor = 'grab';
  }

  onTouchStart(event) {
    if (event.touches.length === 2) {
      // Two fingers: start pinch/pan gesture
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];

      // Pinch distance
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      this.pinchStartDistance = Math.sqrt(dx * dx + dy * dy);
      this.lastPinchDistance = this.pinchStartDistance;
      this.isPinching = true;

      // Pan center
      this.panStartX = (touch1.clientX + touch2.clientX) / 2;
      this.panStartCameraX = this.camera ? this.camera.position.x : 0;
      this.isPanning = true;
      this.onPanStart();

      // Cancel single-finger drag
      this.isDragging = false;
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      const rect = this.canvas.getBoundingClientRect();

      // Record start for click detection
      this.pointerStartX = touch.clientX - rect.left;
      this.pointerStartY = touch.clientY - rect.top;
      this.pointerStartTime = Date.now();
      this.hasMoved = false;

      this.isDragging = true;
      this.lastDragY = touch.clientY;
    }
  }

  onTouchMove(event) {
    if (event.touches.length === 2 && this.isPinching) {
      event.preventDefault();

      const touch1 = event.touches[0];
      const touch2 = event.touches[1];

      // Pinch zoom
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      const pinchDelta = currentDistance - this.lastPinchDistance;
      this.lastPinchDistance = currentDistance;

      if (this.camera) {
        this.camera.position.z += pinchDelta * ZOOM_SENSITIVITY;
        this.camera.position.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.camera.position.z));
      }

      // Pan (two-finger horizontal) - negate delta so content follows fingers
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const panDelta = centerX - this.panStartX;
      const newCameraX = this.panStartCameraX - panDelta * PAN_SENSITIVITY;
      this.targetCameraX = Math.max(PAN_MIN, Math.min(PAN_MAX, newCameraX));
      return;
    }

    if (event.touches.length === 1 && this.isDragging) {
      event.preventDefault();

      const touch = event.touches[0];
      const rect = this.canvas.getBoundingClientRect();

      // Check if movement exceeds click threshold
      if (!this.hasMoved) {
        const deltaX = (touch.clientX - rect.left) - this.pointerStartX;
        const deltaY = (touch.clientY - rect.top) - this.pointerStartY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (distance > CLICK_MAX_DISTANCE) {
          this.hasMoved = true;
        }
      }

      const deltaY = touch.clientY - this.lastDragY;
      this.lastDragY = touch.clientY;

      // Use faster touch sensitivity
      this.targetClimbVelocity += deltaY * TOUCH_DRAG_SENSITIVITY;
      this.clampTargetVelocity();
    }
  }

  onTouchEnd(event) {
    // Reset pinch/pan when going below 2 fingers
    if (event.touches.length < 2) {
      this.isPinching = false;
      this.isPanning = false;
    }

    const wasClick = !this.hasMoved &&
      (Date.now() - this.pointerStartTime) < CLICK_MAX_DURATION;

    // Check for game selection on tap (not drag)
    if (wasClick && this.scene) {
      const pickResult = this.scene.pick(this.pointerStartX, this.pointerStartY);
      if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.metadata?.gameIndex >= 0) {
        this.onGameSelect(pickResult.pickedMesh.metadata);
      }
    }

    this.isDragging = false;
  }

  clampTargetVelocity() {
    if (this.targetClimbVelocity < CLIMB_MIN) {
      this.targetClimbVelocity = CLIMB_MIN;
    }
    if (this.targetClimbVelocity > CLIMB_MAX) {
      this.targetClimbVelocity = CLIMB_MAX;
    }
  }

  /**
   * Update physics - call each frame
   * Returns current climb velocity
   */
  update() {
    // Calculate deltaTime for frame-rate independent physics (normalized to 60fps)
    const now = performance.now();
    const deltaTime = Math.min(this.lastUpdateTime > 0 ? now - this.lastUpdateTime : 16.67, 100);
    this.lastUpdateTime = now;

    // Smooth velocity towards target (normalized to 60fps)
    const smoothing = 1 - Math.pow(0.9, 60 * deltaTime / 1000);
    this.climbVelocity += (this.targetClimbVelocity - this.climbVelocity) * smoothing;

    // Apply friction to target (normalized to 60fps)
    this.targetClimbVelocity *= Math.pow(CLIMB_FRICTION, 60 * deltaTime / 1000);

    // Clamp
    this.clampTargetVelocity();

    // Smooth camera pan (normalized to 60fps)
    if (this.camera) {
      const panSmoothing = 1 - Math.pow(0.9, 60 * deltaTime / 1000);
      this.camera.position.x += (this.targetCameraX - this.camera.position.x) * panSmoothing;
    }

    this.onVelocityChange(this.climbVelocity);

    return this.climbVelocity;
  }

  /**
   * Set velocity directly (for scrolling to specific position)
   */
  setVelocity(velocity) {
    this.climbVelocity = velocity;
    this.targetClimbVelocity = velocity;
  }

  /**
   * Add impulse to velocity
   */
  addImpulse(impulse) {
    this.targetClimbVelocity += impulse;
    this.clampTargetVelocity();
  }

  dispose() {
    this.removeEventListeners();
  }
}
