// src/core/rendering/shadow.ts
import shadowVsUrl from "@/core/shaders/shadow.wgsl?url";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { Mesh, Renderable } from "@/core/types/gpu";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { mat4, Mat4, vec3, Vec3, vec4, Vec4 } from "wgpu-matrix";
import { Shader } from "../shaders/shader";

const MAX_CASCADES = 4;

/**
 * Manages Cascaded Shadow Maps (CSM) for a single directional light.
 *
 * This subsystem is responsible for:
 * - Creating and managing a texture array for the shadow cascades.
 * - Calculating the view frustum splits for each cascade.
 * - Generating a tight-fitting, stabilized orthographic projection for each cascade.
 * - Recording the multi-pass rendering commands to draw shadow casters into the
 *   appropriate layer of the shadow map texture array.
 * - Providing the necessary textures and samplers to the main render pass.
 */
export class ShadowSubsystem {
  private device: GPUDevice;
  private pre: ShaderPreprocessor;

  // Resources
  private shadowMap!: GPUTexture;
  private shadowSampler!: GPUSampler;
  private shadowUniformBuffer!: GPUBuffer;
  private shadowLayerViews: GPUTextureView[] = [];

  // Pipeline
  private pipeline!: GPURenderPipeline;
  private shader!: Shader;
  private shadowBindGroupLayout!: GPUBindGroupLayout;
  private shadowBindGroup!: GPUBindGroup;
  private meshLayouts!: GPUVertexBufferLayout[];
  private instanceLayout!: GPUVertexBufferLayout;
  private depthFormat: GPUTextureFormat = "depth32float";
  private instanceByteStride = 0;
  private currentBias = 1;
  private currentSlope = 1;

  // Cached params
  private mapSize = 2048;
  // The CPU-side buffer must match the GPU-side layout, including padding.
  // Each matrix is at a 256-byte (64-float) offset.
  private shadowUniformsData = new Float32Array(64 * MAX_CASCADES);

  // Temp matrices/vectors
  private lightView: Mat4 = mat4.identity();
  private lightProj: Mat4 = mat4.identity();
  private lightViewProj: Mat4 = mat4.identity();
  private tmpUp: Vec3 = vec3.fromValues(0, 1, 0);
  private tmpVec4: Vec4 = vec4.create();

  // CSM specific
  public cascadeSplits = new Float32Array(MAX_CASCADES);
  public cascadeMatrices: Mat4[] = [];

  constructor(device: GPUDevice) {
    this.device = device;
    this.pre = new ShaderPreprocessor();
    for (let i = 0; i < MAX_CASCADES; i++) {
      this.cascadeMatrices.push(mat4.identity());
    }
  }

  /**
   * Initializes shadow map array, sampler, uniform buffers, and depth-only pipeline.
   * @param meshLayouts Mesh vertex buffer layouts to support in the pipeline.
   * @param instanceLayout The instance buffer layout.
   * @param depthFormat Depth format used for the shadow map array.
   */
  public async init(
    meshLayouts: GPUVertexBufferLayout[],
    instanceLayout: GPUVertexBufferLayout,
    depthFormat: GPUTextureFormat = "depth32float",
  ): Promise<void> {
    this.meshLayouts = meshLayouts;
    this.instanceLayout = instanceLayout;
    this.depthFormat = depthFormat;
    this.instanceByteStride = instanceLayout.arrayStride;
    this.createShadowResources(this.mapSize, depthFormat, MAX_CASCADES);

    this.shader = await Shader.fromUrl(
      this.device,
      this.pre,
      shadowVsUrl,
      "SHADOW_DEPTH_ONLY_SHADER",
      "vs_main",
      "vs_main", // No fragment shader for depth-only
    );

    // Create shadow-specific bind group layout
    this.shadowBindGroupLayout = this.device.createBindGroupLayout({
      label: "SHADOW_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "SHADOW_PIPELINE_LAYOUT",
      bindGroupLayouts: [this.shadowBindGroupLayout],
    });

    // Vertex buffers = mesh buffers + instance buffer at the end
    const buffers: GPUVertexBufferLayout[] = [];
    for (const meshLayout of this.meshLayouts) buffers.push(meshLayout);
    buffers.push(this.instanceLayout);

    this.pipeline = this.device.createRenderPipeline({
      label: "SHADOW_DEPTH_ONLY_PIPELINE",
      layout: pipelineLayout,
      vertex: { module: this.shader.module, entryPoint: "vs_main", buffers },
      primitive: { topology: "triangle-list", cullMode: "front" },
      depthStencil: {
        format: this.depthFormat,
        depthCompare: "less",
        depthWriteEnabled: true,
        depthBias: this.currentBias,
        depthBiasSlopeScale: this.currentSlope,
      },
    });
  }

  private rebuildPipelineIfNeeded(slope: number, bias: number): void {
    if (slope === this.currentSlope && bias === this.currentBias) return;
    this.currentSlope = slope;
    this.currentBias = bias;

    const pipelineLayout = this.device.createPipelineLayout({
      label: "SHADOW_PIPELINE_LAYOUT",
      bindGroupLayouts: [this.shadowBindGroupLayout],
    });

    const buffers: GPUVertexBufferLayout[] = [];
    for (const meshLayout of this.meshLayouts) buffers.push(meshLayout);
    buffers.push(this.instanceLayout);

    this.pipeline = this.device.createRenderPipeline({
      label: "SHADOW_DEPTH_ONLY_PIPELINE",
      layout: pipelineLayout,
      vertex: {
        module: this.shader.module,
        entryPoint: "vs_main",
        buffers,
      },
      primitive: { topology: "triangle-list", cullMode: "front" },
      depthStencil: {
        format: this.depthFormat,
        depthCompare: "less",
        depthWriteEnabled: true,
        depthBias: this.currentBias,
        depthBiasSlopeScale: this.currentSlope,
      },
    });
  }

  private updateShadowBindGroup(): void {
    this.shadowBindGroup = this.device.createBindGroup({
      label: "SHADOW_BIND_GROUP",
      layout: this.shadowBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.shadowUniformBuffer,
            size: 16 * 4, // Size of a single mat4x4
          },
        },
      ],
    });
  }

  private createShadowResources(
    size: number,
    depthFormat: GPUTextureFormat,
    numCascades: number,
  ): void {
    this.shadowMap?.destroy();
    this.shadowMap = this.device.createTexture({
      label: "SUN_SHADOW_MAP_ARRAY",
      size: [size, size, numCascades],
      format: depthFormat,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowLayerViews = [];
    for (let i = 0; i < numCascades; i++) {
      this.shadowLayerViews.push(
        this.shadowMap.createView({
          label: `SHADOW_LAYER_VIEW_${i}`,
          dimension: "2d",
          baseArrayLayer: i,
          arrayLayerCount: 1,
        }),
      );
    }
    this.shadowSampler = this.device.createSampler({
      label: "SUN_SHADOW_SAMPLER",
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    // UBO must be large enough for N matrices, each at a 256-byte offset.
    const matrixSize = 16 * 4;
    const alignedMatrixSize = Math.ceil(matrixSize / 256) * 256;
    const bufferSize = alignedMatrixSize * numCascades;

    this.shadowUniformBuffer ??= this.device.createBuffer({
      label: "SUN_SHADOW_UNIFORMS_CSM",
      size: bufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Updates the shadow subsystem's state for the current frame.
   *
   * This method computes the directional light's view and projection matrices
   * for each cascade to tightly fit the main camera's view frustum splits.
   * It uses a "practical split scheme" to distribute cascades and stabilizes
   * the projection to reduce shimmering. It then packs all cascade matrices
   * into a single uniform buffer for use with dynamic offsets in the shadow pass.
   *
   * @param camera The main scene camera, used to define the view frustum.
   * @param sun The directional light source providing direction.
   * @param settings Global shadow quality settings like map size, number of
   *     cascades, and split scheme lambda.
   */
  public updatePerFrame(
    camera: CameraComponent,
    sun: SceneSunComponent,
    settings: ShadowSettingsComponent,
  ): void {
    const numCascades = Math.max(
      1,
      Math.min(MAX_CASCADES, settings.numCascades),
    );

    if (settings.mapSize !== this.mapSize) {
      this.mapSize = settings.mapSize;
      this.createShadowResources(this.mapSize, this.depthFormat, numCascades);
    }
    this.rebuildPipelineIfNeeded(
      settings.slopeScaleBias,
      settings.constantBias,
    );

    // --- 1. Calculate Cascade Splits ---
    const near = camera.near;
    const far = camera.far;
    this.cascadeSplits[0] = near;
    for (let i = 1; i < numCascades; i++) {
      const ratio = i / numCascades;
      const log = near * Math.pow(far / near, ratio);
      const linear = near + (far - near) * ratio;
      this.cascadeSplits[i] =
        settings.cascadeLambda * log + (1 - settings.cascadeLambda) * linear;
    }
    this.cascadeSplits[numCascades] = far;

    // --- 2. Calculate Light View Matrix (same for all cascades) ---
    const lightDir = vec3.normalize(sun.direction);
    const up =
      Math.abs(vec3.dot(lightDir, this.tmpUp)) > 0.99
        ? vec3.fromValues(1, 0, 0)
        : this.tmpUp;
    // For CSM, we don't need a single center. The view matrix is just orientation.
    // The position is baked into the ortho projection for each cascade.
    mat4.lookAt(vec3.create(0, 0, 0), lightDir, up, this.lightView);

    const invCameraMatrix = mat4.multiply(
      camera.inverseViewMatrix,
      camera.inverseProjectionMatrix,
    );

    // --- 3. Calculate Projection Matrix for each Cascade ---
    for (let i = 0; i < numCascades; i++) {
      const cascadeNear = this.cascadeSplits[i];
      const cascadeFar = this.cascadeSplits[i + 1];

      // Get frustum corners for this cascade split in world space
      const frustumCorners: Vec3[] = [];
      for (let x = -1; x <= 1; x += 2) {
        for (let y = -1; y <= 1; y += 2) {
          // Project points on near and far plane of the cascade split
          const pNear = vec4.transformMat4(
            vec4.fromValues(x, y, -1, 1),
            invCameraMatrix,
          );
          const pFar = vec4.transformMat4(
            vec4.fromValues(x, y, 1, 1),
            invCameraMatrix,
          );
          vec3.scale(pNear, 1 / pNear[3], pNear as Vec3);
          vec3.scale(pFar, 1 / pFar[3], pFar as Vec3);

          const viewDir = vec3.subtract(pFar, pNear);
          vec3.normalize(viewDir, viewDir);

          frustumCorners.push(
            vec3.add(pNear, vec3.scale(viewDir, cascadeNear)),
          );
          frustumCorners.push(vec3.add(pNear, vec3.scale(viewDir, cascadeFar)));
        }
      }

      // Find center of frustum corners
      const frustumCenter = vec3.create();
      frustumCorners.forEach((p) => vec3.add(frustumCenter, p, frustumCenter));
      vec3.scale(frustumCenter, 1 / frustumCorners.length, frustumCenter);

      // Transform corners to light's view space
      let minX = Infinity, minY = Infinity, minZ = Infinity; // prettier-ignore
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity; // prettier-ignore

      for (const p of frustumCorners) {
        const v = vec4.transformMat4(vec4.fromValues(p[0], p[1], p[2], 1), this.lightView); // prettier-ignore
        minX = Math.min(minX, v[0]);
        maxX = Math.max(maxX, v[0]);
        minY = Math.min(minY, v[1]);
        maxY = Math.max(maxY, v[1]);
        minZ = Math.min(minZ, v[2]);
        maxZ = Math.max(maxZ, v[2]);
      }

      // Stabilize projection by snapping to texel grid
      const texelSize = (maxX - minX) / this.mapSize;
      minX = Math.floor(minX / texelSize) * texelSize;
      maxX = Math.floor(maxX / texelSize) * texelSize;
      minY = Math.floor(minY / texelSize) * texelSize;
      maxY = Math.floor(maxY / texelSize) * texelSize;

      // Create ortho projection. In light view space, forward is -Z.
      // The nearest point has the largest Z value (least negative).
      // The farthest point has the smallest Z value (most negative).
      // The ortho `near` plane is at distance -maxZ, `far` is at -minZ.
      const padding = 50.0; // Add padding to avoid clipping casters at cascade edges
      mat4.ortho(
        minX,
        maxX,
        minY,
        maxY,
        -maxZ - padding,
        -minZ + padding,
        this.lightProj,
      );
      mat4.multiply(this.lightProj, this.lightView, this.cascadeMatrices[i]);

      // Write this cascade's matrix to the CPU buffer at the correct offset
      const alignedMatrixSizeFloats = 256 / 4;
      this.shadowUniformsData.set(
        this.cascadeMatrices[i],
        i * alignedMatrixSizeFloats,
      );
    }

    // --- 4. Upload all matrix data to the GPU buffer ---
    this.device.queue.writeBuffer(
      this.shadowUniformBuffer,
      0,
      this.shadowUniformsData.buffer,
    );

    this.updateShadowBindGroup();
  }

  /**
   * Records the shadow depth pass for all shadow-casting renderables.
   */
  public recordShadowPass(
    encoder: GPUCommandEncoder,
    settings: ShadowSettingsComponent,
    renderables: Renderable[],
    instanceBuffer: GPUBuffer,
  ): void {
    if (!this.pipeline || renderables.length === 0) return;

    const numCascades = Math.max(
      1,
      Math.min(MAX_CASCADES, settings.numCascades),
    );
    const alignedMatrixSize = 256;

    for (let i = 0; i < numCascades; i++) {
      const pass = encoder.beginRenderPass({
        label: `SUN_SHADOW_PASS_CASCADE_${i}`,
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowLayerViews[i],
          depthLoadOp: "clear",
          depthStoreOp: "store",
          depthClearValue: 1.0,
        },
      });

      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.shadowBindGroup, [i * alignedMatrixSize]);
      pass.setViewport(0, 0, this.mapSize, this.mapSize, 0, 1);

      let instanceIdx = 0;
      while (instanceIdx < renderables.length) {
        const mesh: Mesh = renderables[instanceIdx].mesh;
        let count = 1;
        while (
          instanceIdx + count < renderables.length &&
          renderables[instanceIdx + count].mesh === mesh
        ) {
          count++;
        }

        for (let b = 0; b < mesh.buffers.length; b++) {
          pass.setVertexBuffer(b, mesh.buffers[b]);
        }
        pass.setVertexBuffer(
          mesh.layouts.length,
          instanceBuffer,
          instanceIdx * this.instanceByteStride,
        );

        if (mesh.indexBuffer) {
          pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
          pass.drawIndexed(mesh.indexCount!, count, 0, 0, 0);
        } else {
          pass.draw(mesh.vertexCount, count, 0, 0);
        }

        instanceIdx += count;
      }

      pass.end();
    }
  }

  /**
   * Provides raw texture/sampler resources for the main PBR shader's frame bind group.
   * The renderer is responsible for querying the matrices/splits and packing them into
   * its own uniform buffer.
   */
  public getFrameTextureBindings(): {
    shadowMapView: GPUTextureView;
    shadowSampler: GPUSampler;
  } {
    return {
      shadowMapView: this.shadowMap.createView({ dimension: "2d-array" }),
      shadowSampler: this.shadowSampler,
    };
  }
}
