// src/core/scene.ts
import { Renderable } from "./types/gpu";

/**
 * Represents a collection of objects to be rendered in the world.
 */
export class Scene {
  public objects: Renderable[] = [];

  /**
   * Adds a renderable object to the scene.
   * @param object The renderable object to add.
   */
  public add(object: Renderable): void {
    this.objects.push(object);
  }
}
