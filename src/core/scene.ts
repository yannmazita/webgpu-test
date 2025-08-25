// src/core/scene.ts
import { Light, Renderable } from "./types/gpu";
import { SceneNode } from "./sceneNode";

/**
 * Represents a collection of objects and lights to be rendered in the world.
 *
 * The Scene class acts as a container for all the `Renderable` objects
 * that make up the visible world, organized in a hierarchical graph structure.
 */
export class Scene {
  /** The root node of the scene graph. All other nodes are descendants of this. */
  public root: SceneNode = new SceneNode();
  /** Light sources for the scene. */
  public lights: Light[] = [];

  /**
   * Adds a node to the scene's root.
   * @param node The SceneNode to add.
   */
  public add(node: SceneNode): void {
    this.root.addChild(node);
  }

  /**
   * Removes a node from the scene's root.
   * @param node The SceneNode to remove.
   */
  public remove(node: SceneNode): void {
    this.root.removeChild(node);
  }

  /**
   * Adds a light to the scene.
   * @param light The light to add.
   */
  public addLight(light: Light): void {
    this.lights.push(light);
  }

  /**
   * Removes a light from the scene.
   * @param lightToRemove The light to remove.
   * @returns True if the light was found and removed, false otherwise.
   */
  public removeLight(lightToRemove: Light): boolean {
    const index = this.lights.findIndex((light) => light === lightToRemove);
    if (index > -1) {
      this.lights.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Traverses the scene graph, updates all world matrices, and collects
   * all renderable objects for the renderer.
   * @returns A flat list of objects to be rendered.
   */
  public getRenderables(): Renderable[] {
    // First, update all world matrices starting from the root.
    // The dirty flag system ensures this is efficient.
    this.root.updateWorldMatrix();

    const renderables: Renderable[] = [];
    const traverse = (node: SceneNode) => {
      // If a node has both a mesh and a material, it's renderable.
      if (node.mesh && node.material) {
        renderables.push({
          mesh: node.mesh,
          material: node.material,
          modelMatrix: node.worldMatrix,
        });
      }
      // Recurse for all children
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.root);
    return renderables;
  }
}
