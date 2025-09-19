// src/core/types/renderer.ts
import { Mesh } from "./gpu";
import { MaterialInstance } from "../materials/materialInstance";

/**
 * Represents a pre-computed batch of objects that can be drawn with a single
 * instanced draw call. This is used by the opaque pass to optimize rendering.
 */
export interface DrawBatch {
  /** The render pipeline to use for this batch. */
  pipeline: GPURenderPipeline;
  /** The material instance shared by all objects in this batch. */
  materialInstance: MaterialInstance;
  /** The mesh shared by all objects in this batch. */
  mesh: Mesh;
  /** The number of instances to draw in this batch. */
  instanceCount: number;
  /** The starting offset in the global instance buffer for this batch. */
  firstInstance: number;
}

/**
 * A collection of performance and state metrics captured by the renderer
 * during a single frame.
 */
export interface RendererStats {
  /** The physical width of the rendering canvas in pixels. */
  canvasWidth: number;
  /** The physical height of the rendering canvas in pixels. */
  canvasHeight: number;
  /** The total number of lights in the scene. */
  lightCount: number;
  /** The number of opaque objects visible in the camera frustum. */
  visibleOpaque: number;
  /** The number of transparent objects visible in the camera frustum. */
  visibleTransparent: number;
  /** The number of draw calls submitted for opaque objects. */
  drawsOpaque: number;
  /** The number of draw calls submitted for transparent objects. */
  drawsTransparent: number;
  /** The total number of instances rendered for opaque objects. */
  instancesOpaque: number;
  /** The total number of instances rendered for transparent objects. */
  instancesTransparent: number;
  /** The total CPU time spent in the render method, in microseconds. */
  cpuTotalUs: number;
  /** The average number of lights per cluster, scaled by 1000. */
  clusterAvgLpcX1000?: number;
  /** The maximum number of lights found in any single cluster. */
  clusterMaxLpc?: number;
  /** The number of clusters that overflowed their light capacity. */
  clusterOverflows?: number;
}
