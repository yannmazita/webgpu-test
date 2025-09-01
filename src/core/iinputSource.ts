// src/core/iinputSource.ts

export interface IInputSource {
  /**
   * Checks if a specific key is currently held down.
   * @param code The KeyboardEvent.code of the key to check.
   * @returns True if the key is down, false otherwise.
   */
  isKeyDown(code: string): boolean;

  /**
   * Gets the mouse movement since the last frame.
   * @returns An object with x and y deltas.
   */
  getMouseDelta(): { x: number; y: number };

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
