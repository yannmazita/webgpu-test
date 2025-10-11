// src/core/iinputSource.ts

export interface IInputSource {
  /**
   * Checks if a specific key is currently held down.
   * @param code The KeyboardEvent.code of the key to check.
   * @returns True if the key is down, false otherwise.
   */
  isKeyDown(code: string): boolean;

  /**
   * Checks if a specific mouse button is currently held down.
   * @param button The button index (0=left, 1=middle, 2=right).
   * @returns True if the button is down, false otherwise.
   */
  isMouseButtonDown(button: number): boolean;

  /**
   * Gets the mouse movement since the last frame.
   * @returns An object with x and y deltas.
   */
  getMouseDelta(): { x: number; y: number };

  /**
   * Gets the last known mouse position in CSS pixels relative to the viewport.
   */
  getMousePosition(): { x: number; y: number };

  /**
   * Checks if the pointer is currently locked to the canvas.
   * @returns True if the pointer is locked.
   */
  isPointerLocked(): boolean;

  /**
   * Called at the end of a frame to reset per-frame state.
   */
  lateUpdate(): void;
}
