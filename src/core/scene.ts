// src/core/scene.ts
import { Light, Renderable } from "./types/gpu";

/**
 * Represents a collection of objects and lights to be rendered in the world.
 *
 * The Scene class acts as a container for all the `Renderable` objects
 * that make up the visible world. The renderer will iterate over the
 * objects in this scene during the rendering passes.
 */
export class Scene {
  /** The list of renderable objects in the scene. */
  public objects: Renderable[] = [];
  /** Light sources for the scene. */
  public lights: Light[] = [];

  /**
   * Adds a renderable object to the scene.
   * @param object The renderable object to add.
   */
  public add(object: Renderable): void {
    this.objects.push(object);
  }

  /**
   * Adds a light to the scene.
   * @param light The light to add.
   */
  public addLight(light: Light): void {
    this.lights.push(light);
  }
}
