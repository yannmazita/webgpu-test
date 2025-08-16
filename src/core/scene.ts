// src/core/scene.ts
import { Renderable } from "./types/gpu";

/**
 * Represents a collection of objects to be rendered in the world.
 *
 * The Scene class acts as a container for all the `Renderable` objects
 * that make up the visible world. The `Renderer` will iterate over the
 * objects in this scene during the render pass.
 */
export class Scene {
  /** The list of renderable objects in the scene. */
  public objects: Renderable[] = [];

  /**
   * Adds a renderable object to the scene.
   * @param object The renderable object to add.
   */
  public add(object: Renderable): void {
    this.objects.push(object);
  }
}
