// src/core/inputManager.ts

/**
 * Manages user input from keyboard and mouse.
 * Handles pointer lock for a first-person camera experience.
 */
export class InputManager {
  /** A set of currently pressed keys, identified by their KeyboardEvent.code. */
  public readonly keys = new Set<string>();
  /** The change in mouse position since the last frame. */
  public readonly mouseDelta = { x: 0, y: 0 };
  /** The current mouse position in pixels, relative to the canvas top-left. */
  public readonly mousePosition = { x: -1, y: -1 };
  /** Indicates if the pointer is currently locked to the canvas. */
  public isPointerLocked = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.addEventListeners();
  }

  private addEventListeners(): void {
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.canvas.addEventListener("click", this.handleCanvasClick);
    document.addEventListener("mousemove", this.handleMouseMove);
  }

  /**
   * Cleans up all event listeners.
   */
  public destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.canvas.removeEventListener("click", this.handleCanvasClick);
    document.removeEventListener("mousemove", this.handleMouseMove);
  }

  /**
   * Resets mouse delta. Should be called at the end of each frame
   * to prepare for the next frame's input.
   */
  public lateUpdate(): void {
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Store both the physical code and the actual key character
    this.keys.add(e.code);
    // Also add the uppercase key character for layout independence
    if (e.key.length === 1) {
      this.keys.add(`Key_${e.key.toUpperCase()}`);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    // Also remove the key character
    if (e.key.length === 1) {
      this.keys.delete(`Key_${e.key.toUpperCase()}`);
    }
  };

  private handleCanvasClick = (): void => {
    if (!this.isPointerLocked) {
      this.canvas.requestPointerLock();
    }
  };

  private handlePointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  };

  private handleMouseMove = (e: MouseEvent): void => {
    // Update delta when pointer is locked
    if (this.isPointerLocked) {
      this.mouseDelta.x += e.movementX;
      this.mouseDelta.y += e.movementY;
    }

    // Update absolute position regardless of lock state
    const rect = this.canvas.getBoundingClientRect();
    this.mousePosition.x = e.clientX - rect.left;
    this.mousePosition.y = e.clientY - rect.top;
  };
}
