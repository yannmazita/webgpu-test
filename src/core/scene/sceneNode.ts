// src/core/scene/sceneNode.ts
import { Mat4 } from "wgpu-matrix";
import { Mesh, Light } from "@/core/types/gpu";
import { Material } from "@/core/materials/material";
import { Transform } from "@/core/scene/transform";

export class SceneNode {
  /** The transformation component for this node. */
  public readonly transform: Transform;

  // Graph structure
  public parent: SceneNode | null = null;
  public children: SceneNode[] = [];

  // Attached components
  public mesh?: Mesh;
  public material?: Material;
  public light?: Light;

  constructor() {
    this.transform = new Transform(this);
  }

  // --- Graph Management ---

  public addChild(node: SceneNode): void {
    if (node.parent) {
      node.parent.removeChild(node);
    }
    node.parent = this;
    this.children.push(node);
    // When a child is added, its transform hierarchy needs to be marked dirty
    // so its world matrix is recalculated relative to its new parent.
    node.transform.makeDirty();
  }

  public removeChild(node: SceneNode): void {
    const index = this.children.indexOf(node);
    if (index > -1) {
      node.parent = null;
      this.children.splice(index, 1);
    }
  }

  /**
   * Recursively destroys this node and all its children, removing them from the scene graph.
   * This performs the logical removal. For GPU resource cleanup, the corresponding
   * resources in the ResourceManager must also be destroyed separately.
   */
  public destroy(): void {
    // Destroy children first (depth-first).
    // We iterate over a copy of the children array because the original array
    // will be modified by each child's destroy() call as it removes itself.
    [...this.children].forEach((child) => child.destroy());

    // Remove self from parent.
    if (this.parent) {
      this.parent.removeChild(this);
    }
  }

  // --- Core Update Logic ---

  /**
   * Updates the world matrix of this node and all its children by delegating
   * to its transform component.
   * @param parentWorldMatrix The world matrix of the parent node.
   * @param force - If true, forces a matrix recalculation even if not dirty.
   */
  public updateWorldMatrix(parentWorldMatrix?: Mat4, force = false): void {
    this.transform.updateWorldMatrix(parentWorldMatrix, force);
  }
}
