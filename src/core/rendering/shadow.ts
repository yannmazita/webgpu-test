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

export class ShadowSubsystem {
  private device: GPUDevice;
  private pre: ShaderPreprocessor;

  private static readonly NUM_CASCADES = 4;

  // Resources
  private shadowMap!: GPUTexture;
  private shadowViews!: GPUTextureView[];
  private shadowSampler!: GPUSampler;
  private csmFrameUniformBuffer!: GPUBuffer;
  private shadowPassUniformBuffer!: GPUBuffer;

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
  // 4 cascades * (1 mat4x4 viewProj + 1 vec4 for split depth) = 4 * (16 + 4) = 80 floats
  // Plus lightDir (vec4), lightColor (vec4), params0 (vec4) = 12 floats
  // Total = 92 floats. Pad to 96 for alignment.
  private shadowUniformsData = new Float32Array(96);

  // Temp matrices/vectors
  private lightView: Mat4 = mat4.identity();
  private lightProj: Mat4 = mat4.identity();
  private lightViewProj: Mat4[] = [
    mat4.identity(),
    mat4.identity(),
    mat4.identity(),
    mat4.identity(),
  ];
  private cascadeSplits = new Float32Array(ShadowSubsystem.NUM_CASCADES);
  private tmpUp: Vec3 = vec3.fromValues(0, 1, 0);
  private tmpVec4: Vec4 = vec4.create();

  constructor(device: GPUDevice) {
    this.device = device;
    this.pre = new ShaderPreprocessor();
  }

  /**
   * Initializes shadow map, sampler, uniform buffer, and depth-only pipeline.
   * @param frameBgl The frame bind group layout to build pipeline layout.
   * @param meshLayouts Mesh vertex buffer layouts to support in the pipeline.
   * @param instanceLayout The instance buffer layout.
   * @param depthFormat Depth format used for shadow map.
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
    this.createShadowResources(this.mapSize, depthFormat);

    this.shader = await Shader.fromUrl(
      this.device,
      this.pre,
      shadowVsUrl,
      "SHADOW_DEPTH_ONLY_SHADER",
      "vs_main",
      "vs_main",
    );

    // Create shadow-specific bind group layout
    this.shadowBindGroupLayout = this.device.createBindGroupLayout({
      label: "SHADOW_PASS_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          // REMOVE DYNAMIC OFFSET
          buffer: { type: "uniform" },
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
      label: "SHADOW_PASS_BIND_GROUP",
      layout: this.shadowBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.shadowPassUniformBuffer } },
      ],
    });
  }

  private createShadowResources(
    size: number,
    depthFormat: GPUTextureFormat,
  ): void {
    // Destroy the old texture if it exists
    this.shadowMap?.destroy();

    // Create a 2D texture array for the cascades
    this.shadowMap = this.device.createTexture({
      label: "SUN_SHADOW_MAP",
      size: [size, size, ShadowSubsystem.NUM_CASCADES],
      format: depthFormat,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Create a separate view for each cascade/layer
    this.shadowViews = [];
    for (let i = 0; i < ShadowSubsystem.NUM_CASCADES; ++i) {
      this.shadowViews.push(
        this.shadowMap.createView({
          label: `SUN_SHADOW_MAP_VIEW_CASCADE_${i}`,
          dimension: "2d",
          baseArrayLayer: i,
          arrayLayerCount: 1,
        }),
      );
    }

    // Create the comparison sampler for shadow lookups in the PBR shader
    this.shadowSampler = this.device.createSampler({
      label: "SUN_SHADOW_SAMPLER",
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    // Buffer 1: The LARGE uniform buffer for the PBR pass (frame bind group).
    // It contains all cascade matrices and global shadow settings.
    const frameUniformBufferSize = Math.max(
      this.shadowUniformsData.byteLength,
      256, // Ensure it's at least 256 bytes for good practice
    );
    this.csmFrameUniformBuffer ??= this.device.createBuffer({
      label: "CSM_FRAME_UNIFORMS",
      size: frameUniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Buffer 2: The SMALL uniform buffer for the shadow pass itself.
    // It only needs to hold data for a single cascade at a time.
    const cascadeStructSizeBytes = 20 * 4; // 1 mat4x4 (16f) + 1 vec4 (4f)
    this.shadowPassUniformBuffer ??= this.device.createBuffer({
      label: "SHADOW_PASS_UNIFORM_BUFFER",
      size: cascadeStructSizeBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  public updatePerFrame(
    camera: CameraComponent,
    sun: SceneSunComponent,
    settings: ShadowSettingsComponent,
  ): void {
    if (settings.mapSize !== this.mapSize) {
      this.mapSize = settings.mapSize;
      this.createShadowResources(this.mapSize, this.depthFormat);
    }
    this.rebuildPipelineIfNeeded(
      settings.slopeScaleBias,
      settings.constantBias,
    );

    // --- Cascaded Shadow Map Frustum Calculation ---
    const cascadeSplitLambda = 0.95;
    const cameraNear = camera.near;
    const cameraFar = camera.far;
    const clipRange = cameraFar - cameraNear;
    const minZ = cameraNear;
    const maxZ = cameraFar;
    const range = maxZ - minZ;
    const ratio = maxZ / minZ;

    const cascadeSplits = [0.0, 0.0, 0.0, 0.0];
    for (let i = 0; i < ShadowSubsystem.NUM_CASCADES; i++) {
      const p = (i + 1) / ShadowSubsystem.NUM_CASCADES;
      const log = minZ * Math.pow(ratio, p);
      const uniform = minZ + range * p;
      const d = cascadeSplitLambda * (log - uniform) + uniform;
      cascadeSplits[i] = (d - cameraNear) / clipRange;
    }

    const dir = vec3.normalize(sun.direction);
    const up =
      Math.abs(vec3.dot(dir, this.tmpUp)) > 0.95
        ? vec3.fromValues(1, 0, 0)
        : this.tmpUp;
    const invCam = mat4.multiply(
      camera.inverseViewMatrix,
      camera.inverseProjectionMatrix,
    );

    let lastSplitDist = 0.0;
    for (let i = 0; i < ShadowSubsystem.NUM_CASCADES; i++) {
      const splitDist = cascadeSplits[i];
      const frustumCorners: Vec3[] = [];
      const clipCorners: [number, number, number, number][] = [
        [-1, -1, -1, 1],
        [1, -1, -1, 1],
        [-1, 1, -1, 1],
        [1, 1, -1, 1],
        [-1, -1, 1, 1],
        [1, -1, 1, 1],
        [-1, 1, 1, 1],
        [1, 1, 1, 1],
      ];

      for (const c of clipCorners) {
        const clip = vec4.fromValues(c[0], c[1], c[2], 1.0);
        const invClip = vec4.transformMat4(clip, invCam);
        frustumCorners.push(vec3.scale(invClip, 1.0 / invClip[3]));
      }

      const frustumCenter = vec3.create();
      for (const p of frustumCorners) {
        vec3.add(frustumCenter, p, frustumCenter);
      }
      vec3.scale(frustumCenter, 1.0 / frustumCorners.length, frustumCenter);

      const lightDist = 100.0;
      const eye = vec3.fromValues(
        frustumCenter[0] - dir[0] * lightDist,
        frustumCenter[1] - dir[1] * lightDist,
        frustumCenter[2] - dir[2] * lightDist,
      );
      mat4.lookAt(eye, frustumCenter, up, this.lightView);

      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;
      for (const p of frustumCorners) {
        this.tmpVec4[0] = p[0];
        this.tmpVec4[1] = p[1];
        this.tmpVec4[2] = p[2];
        this.tmpVec4[3] = 1.0;
        const v = vec4.transformMat4(this.tmpVec4, this.lightView);
        if (v[0] < minX) minX = v[0];
        if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1];
        if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2];
        if (v[2] > maxZ) maxZ = v[2];
      }

      const zNear = Math.max(0.1, minZ - 100.0);
      const zFar = maxZ + 100.0;
      mat4.ortho(minX, maxX, minY, maxY, zNear, zFar, this.lightProj);
      mat4.multiply(this.lightProj, this.lightView, this.lightViewProj[i]);
      this.cascadeSplits[i] = cameraNear + splitDist * clipRange;
      lastSplitDist = splitDist;
    }

    // 9. Pack all data into the uniform buffer, matching the shader struct layout.
    for (let i = 0; i < ShadowSubsystem.NUM_CASCADES; ++i) {
      // Each cascade struct is 20 floats (16 for matrix, 4 for split depth vec4)
      const offset = i * 20;
      this.shadowUniformsData.set(this.lightViewProj[i], offset);
      this.shadowUniformsData.set(
        [this.cascadeSplits[i], 0, 0, 0],
        offset + 16,
      );
    }

    const baseOffset = ShadowSubsystem.NUM_CASCADES * 20;
    this.shadowUniformsData.set([dir[0], dir[1], dir[2], 0.0], baseOffset);
    this.shadowUniformsData.set(
      [sun.color[0], sun.color[1], sun.color[2], sun.color[3]],
      baseOffset + 4,
    );
    this.shadowUniformsData.set(
      [sun.color[3], settings.pcfRadius, this.mapSize, settings.depthBias],
      baseOffset + 8,
    );

    // Upload the LARGE buffer for the PBR pass
    this.device.queue.writeBuffer(
      this.csmFrameUniformBuffer,
      0,
      this.shadowUniformsData,
    );

    this.updateShadowBindGroup();
  }

  /**
   * Records the shadow depth pass for all shadow-casting renderables.
   * Uses the shared instance buffer. Expects the caller to have written instance data.
   */
  public recordShadowPass(
    encoder: GPUCommandEncoder,
    mapSize: number,
    renderables: Renderable[],
    instanceBuffer: GPUBuffer,
  ): void {
    if (!this.pipeline || renderables.length === 0) {
      return;
    }

    for (let i = 0; i < ShadowSubsystem.NUM_CASCADES; ++i) {
      const cascadeData = this.shadowUniformsData.subarray(i * 20, i * 20 + 20);
      this.device.queue.writeBuffer(
        this.shadowPassUniformBuffer,
        0,
        cascadeData,
      );

      const pass = encoder.beginRenderPass({
        label: `SUN_SHADOW_PASS_CASCADE_${i}`,
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowViews[i],
          depthLoadOp: "clear",
          depthStoreOp: "store",
          depthClearValue: 1.0,
        },
      });

      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.shadowBindGroup);
      pass.setViewport(0, 0, mapSize, mapSize, 0, 1);

      let drawnCount = 0;
      while (drawnCount < renderables.length) {
        const mesh: Mesh = renderables[drawnCount].mesh;
        let count = 1;
        while (
          drawnCount + count < renderables.length &&
          renderables[drawnCount + count].mesh === mesh
        ) {
          count++;
        }

        for (let b = 0; b < mesh.buffers.length; b++) {
          pass.setVertexBuffer(b, mesh.buffers[b]);
        }
        pass.setVertexBuffer(
          mesh.layouts.length,
          instanceBuffer,
          drawnCount * this.instanceByteStride,
        );

        if (mesh.indexBuffer) {
          pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
          pass.drawIndexed(mesh.indexCount!, count, 0, 0, 0);
        } else {
          pass.draw(mesh.vertexCount, count, 0, 0);
        }
        drawnCount += count;
      }
      pass.end();
    }
  }

  /**
   * Provides resources for the frame bind group entries
   */
  public getFrameBindings(): {
    shadowMapView: GPUTextureView;
    shadowSampler: GPUSampler;
    shadowUniformBuffer: GPUBuffer;
  } {
    return {
      shadowMapView: this.shadowMap.createView({
        label: "SHADOW_MAP_ARRAY_VIEW",
        dimension: "2d-array",
      }),
      shadowSampler: this.shadowSampler,
      // return the large CSM buffer
      shadowUniformBuffer: this.csmFrameUniformBuffer,
    };
  }

  public writeDisabled(): void {
    // Zero sun contribution by setting intensity to 0 and neutral data.
    this.shadowUniformsData.fill(0);
    const ident = mat4.identity();
    for (let i = 0; i < ShadowSubsystem.NUM_CASCADES; ++i) {
      this.shadowUniformsData.set(ident, i * 20);
    }
    this.device.queue.writeBuffer(
      this.csmFrameUniformBuffer,
      0,
      this.shadowUniformsData,
    );
  }
}
