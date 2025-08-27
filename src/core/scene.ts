// src/core/scene.ts
import { Light, Renderable } from "./types/gpu";
import { SceneNode } from "./sceneNode";
import { vec4, Vec4 } from "wgpu-matrix";

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
  /** The global ambient light color for the scene. */
  public ambientColor: Vec4 = vec4.fromValues(0.1, 0.1, 0.1, 1.0);

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
    // The dirty flag ensures this is efficient.
    this.root.updateWorldMatrix();

    const renderables: Renderable[] = [];
    const traverse = (node: SceneNode, parentIsUniformlyScaled: boolean) => {
      // Check if the node's own local scale is uniform.
      const isNodeScaleUniform =
        node.scale[0] === node.scale[1] && node.scale[1] === node.scale[2];

      // The final world transform is uniform only if the parent's was and this node's is.
      const isWorldScaleUniform = parentIsUniformlyScaled && isNodeScaleUniform;

      // If a node has both a mesh and a material, it's renderable.
      if (node.mesh && node.material) {
        renderables.push({
          mesh: node.mesh,
          material: node.material,
          modelMatrix: node.worldMatrix,
          isUniformlyScaled: isWorldScaleUniform,
        });
      }
      // Recurse for all children
      for (const child of node.children) {
        traverse(child, isWorldScaleUniform);
      }
    };

    traverse(this.root, true); // Start traversal, assuming root of the parent is uniform.
    return renderables;
  }
}
