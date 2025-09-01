// src/core/remoteInputSource.ts
export class RemoteInputSource {
  public readonly keys = new Set<string>();
  public readonly mouseDelta = { x: 0, y: 0 };
  public isPointerLocked = false;

  public lateUpdate(): void {
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  public applyInput(
    keys: string[],
    mouseDeltaX: number,
    mouseDeltaY: number,
    isPointerLocked: boolean,
  ): void {
    // Replace key set
    this.keys.clear();
    for (const k of keys) this.keys.add(k);
    // Accumulate deltas for the frame; ActionManager reads then we zero in lateUpdate
    this.mouseDelta.x += mouseDeltaX | 0;
    this.mouseDelta.y += mouseDeltaY | 0;
    this.isPointerLocked = isPointerLocked;
  }
}
