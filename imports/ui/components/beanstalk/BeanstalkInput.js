/**
 * BeanstalkInput.js - Scroll/drag/touch navigation with momentum physics
 */

const CLIMB_FRICTION = 0.95;
const CLIMB_MIN = -0.5;
const CLIMB_MAX = 3.0;
const SCROLL_SENSITIVITY = 0.03;
const DRAG_SENSITIVITY = 0.2;

export class BeanstalkInput {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.onGameSelect = options.onGameSelect || (() => {});
    this.onVelocityChange = options.onVelocityChange || (() => {});

    // Velocity state
    this.climbVelocity = 1.0;
    this.targetClimbVelocity = 1.0;

    // Drag state
    this.isDragging = false;
    this.lastDragY = 0;

    // Scene reference for raycasting
    this.scene = null;

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

  setupEventListeners() {
    // Wheel for scrolling
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    // Pointer events for drag (works for mouse and touch)
    this.canvas.addEventListener('pointerdown', this.onPointerDown, false);
    this.canvas.addEventListener('pointermove', this.onPointerMove, false);
    this.canvas.addEventListener('pointerup', this.onPointerUp, false);
    this.canvas.addEventListener('pointerleave', this.onPointerUp, false);

    // Touch events for mobile
    this.canvas.addEventListener('touchstart', this.onTouchStart, false);
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd, false);

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
    // Scroll up (negative deltaY) = climb faster, scroll down = slow/reverse
    this.targetClimbVelocity -= event.deltaY * SCROLL_SENSITIVITY;
    this.clampTargetVelocity();
  }

  onPointerDown(event) {
    // Check if clicking on a game case
    if (this.scene && !this.isDragging) {
      const pickResult = this.scene.pick(event.offsetX, event.offsetY);
      if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.metadata?.gameData) {
        this.onGameSelect(pickResult.pickedMesh.metadata);
        return;
      }
    }

    event.preventDefault();
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

    const deltaY = event.clientY - this.lastDragY;
    this.lastDragY = event.clientY;

    // Drag down = climb faster, drag up = slow/reverse
    this.targetClimbVelocity += deltaY * DRAG_SENSITIVITY;
    this.clampTargetVelocity();
  }

  onPointerUp(event) {
    if (this.isDragging && event.pointerId !== undefined) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.isDragging = false;
    this.canvas.style.cursor = 'grab';
  }

  onTouchStart(event) {
    if (event.touches.length === 1) {
      this.isDragging = true;
      this.lastDragY = event.touches[0].clientY;
    }
  }

  onTouchMove(event) {
    if (event.touches.length === 1 && this.isDragging) {
      event.preventDefault();

      const deltaY = event.touches[0].clientY - this.lastDragY;
      this.lastDragY = event.touches[0].clientY;

      this.targetClimbVelocity += deltaY * DRAG_SENSITIVITY;
      this.clampTargetVelocity();
    }
  }

  onTouchEnd() {
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
    // Smooth velocity towards target
    this.climbVelocity += (this.targetClimbVelocity - this.climbVelocity) * 0.1;

    // Apply friction to target
    this.targetClimbVelocity *= CLIMB_FRICTION;

    // Clamp
    this.clampTargetVelocity();

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
