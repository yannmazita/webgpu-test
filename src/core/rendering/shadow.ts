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

/**
 * Manages shadow resources and the depth-only shadow pass for a single directional light.
 */
export class ShadowSubsystem {
  private device: GPUDevice;
  private pre: ShaderPreprocessor;

  // Resources
  private shadowMap!: GPUTexture;
  private shadowView!: GPUTextureView;
  private shadowSampler!: GPUSampler;
  private shadowUniformBuffer!: GPUBuffer;

  // Pipeline
  private pipeline!: GPURenderPipeline;
  private shader!: Shader;
  private frameBgl!: GPUBindGroupLayout;
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
  private shadowUniformsData = new Float32Array(36); // 4x4 + 3 vec4 = 16 + 12 = 28 floats, pad to multiple of 4

  // Temp matrices/vectors
  private lightView: Mat4 = mat4.identity();
  private lightProj: Mat4 = mat4.identity();
  private lightViewProj: Mat4 = mat4.identity();
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
      label: "SHADOW_BIND_GROUP_LAYOUT",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
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
      label: "SHADOW_BIND_GROUP",
      layout: this.shadowBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.shadowUniformBuffer } }],
    });
  }

  private createShadowResources(
    size: number,
    depthFormat: GPUTextureFormat,
  ): void {
    this.shadowMap?.destroy();
    this.shadowMap = this.device.createTexture({
      label: "SUN_SHADOW_MAP",
      size: [size, size, 1],
      format: depthFormat,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowView = this.shadowMap.createView();
    this.shadowSampler = this.device.createSampler({
      label: "SUN_SHADOW_SAMPLER",
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.shadowUniformBuffer ??= this.device.createBuffer({
      label: "SUN_SHADOW_UNIFORMS",
      size: 36 * 4, // 144B
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Updates the shadow subsystem's state for the current frame.
   *
   * This method computes the directional light's view and projection matrices
   * to tightly fit the main camera's view frustum, a technique known as a
   * single-cascade shadow map. It then packs all necessary data (matrices,
   * light properties, quality settings) into a uniform buffer for the GPU.
   * It also handles dynamic resizing of the shadow map texture and
   * recreation of the depth pipeline if rasterization settings change.
   *
   * @param {CameraComponent} camera The main scene camera, used to define the
   *     view frustum that shadows must cover.
   * @param {SceneSunComponent} sun The directional light source providing
   *     direction and color.
   * @param {ShadowSettingsComponent} settings Global shadow quality settings
   *     like map size and bias values.
   * @returns {void}
   */
  public updatePerFrame(
    camera: CameraComponent,
    sun: SceneSunComponent,
    settings: ShadowSettingsComponent,
  ): void {
    if (settings.mapSize !== this.mapSize) {
      this.mapSize = settings.mapSize;
      this.createShadowResources(this.mapSize, this.depthFormat);
    }
    // Rebuild pipeline if slope/constant bias have changed
    this.rebuildPipelineIfNeeded(
      settings.slopeScaleBias,
      settings.constantBias,
    );

    // --- Fit shadow map to camera frustum (Single Cascade) ---

    // 1. Get the 8 corners of the camera's frustum in world space.
    const clipCorners: [number, number, number, number][] = [
      [-1, -1, -1, 1],
      [1, -1, -1, 1],
      [-1, 1, -1, 1],
      [1, 1, -1, 1], // Near plane
      [-1, -1, 1, 1],
      [1, -1, 1, 1],
      [-1, 1, 1, 1],
      [1, 1, 1, 1], // Far plane
    ];
    const invVP = mat4.multiply(
      camera.inverseViewMatrix,
      camera.inverseProjectionMatrix,
    );
    const worldCorners: Vec3[] = [];
    for (const c of clipCorners) {
      const clip = c as unknown as Float32Array;
      const v4 = vec4.transformMat4(clip, invVP);
      const invw = v4[3] !== 0 ? 1.0 / v4[3] : 1.0;
      worldCorners.push(
        vec3.fromValues(v4[0] * invw, v4[1] * invw, v4[2] * invw),
      );
    }

    // 2. Compute the center of the frustum to use as the look-at target.
    const frustumCenter = vec3.create();
    for (const p of worldCorners) {
      vec3.add(frustumCenter, p, frustumCenter);
    }
    vec3.scale(frustumCenter, 1.0 / worldCorners.length, frustumCenter);

    // 3. Create the light's view matrix.
    const dir = vec3.normalize(sun.direction);
    const up =
      Math.abs(vec3.dot(dir, this.tmpUp)) > 0.95
        ? vec3.fromValues(1, 0, 0)
        : this.tmpUp;
    // Position the light "camera" far enough back to see the whole frustum.
    const lightDist = 50.0; // A safe distance.
    const eye = vec3.fromValues(
      frustumCenter[0] - dir[0] * lightDist,
      frustumCenter[1] - dir[1] * lightDist,
      frustumCenter[2] - dir[2] * lightDist,
    );
    mat4.lookAt(eye, frustumCenter, up, this.lightView);

    // 4. Find the min/max extents of the frustum in light-space.
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const p of worldCorners) {
      // Promote vec3 to vec4 (w=1) for point transformation
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

    // 5. Create a tight orthographic projection matrix around these extents.
    // Add a small safety margin to near/far planes.
    const zNear = Math.max(0.1, minZ - 50.0);
    const zFar = maxZ + 50.0;
    mat4.ortho(minX, maxX, minY, maxY, zNear, zFar, this.lightProj);

    // 6. Combine to get the final light view-projection matrix.
    mat4.multiply(this.lightProj, this.lightView, this.lightViewProj);

    // 7. Pack all data into the uniform buffer.
    this.shadowUniformsData.set(this.lightViewProj, 0); // mat4x4
    this.shadowUniformsData.set([dir[0], dir[1], dir[2], 0.0], 16); // vec4 lightDir
    this.shadowUniformsData.set(
      [sun.color[0], sun.color[1], sun.color[2], sun.color[3]], // Use w as intensity
      20,
    );
    // params0: [intensity, pcfRadius, mapSize, depthBias]
    this.shadowUniformsData.set(
      [sun.color[3], settings.pcfRadius, this.mapSize, settings.depthBias],
      24,
    );
    // Uploading the packed data to the GPU buffer
    this.device.queue.writeBuffer(
      this.shadowUniformBuffer,
      0,
      this.shadowUniformsData,
    );

    // Create the bind group with updated uniforms
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
    if (!this.pipeline) return;
    if (renderables.length === 0) return;

    const pass = encoder.beginRenderPass({
      label: "SUN_SHADOW_PASS",
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowView,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.shadowBindGroup);
    pass.setViewport(0, 0, mapSize, mapSize, 0, 1);

    // Draw by grouping consecutive renderables with same mesh to reduce state changes.
    let i = 0;
    while (i < renderables.length) {
      const mesh: Mesh = renderables[i].mesh;
      let count = 1;
      // Count consecutive instances with same mesh
      while (
        i + count < renderables.length &&
        renderables[i + count].mesh === mesh
      ) {
        count++;
      }

      // Bind mesh vertex buffers
      for (let b = 0; b < mesh.buffers.length; b++) {
        pass.setVertexBuffer(b, mesh.buffers[b]);
      }
      // Instance buffer goes after mesh buffers
      pass.setVertexBuffer(
        mesh.layouts.length,
        instanceBuffer,
        i * this.instanceByteStride,
      );

      if (mesh.indexBuffer) {
        pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat!);
        pass.drawIndexed(mesh.indexCount!, count, 0, 0, 0);
      } else {
        pass.draw(mesh.vertexCount, count, 0, 0);
      }

      i += count;
    }

    pass.end();
  }

  /**
   * Provides resources for the frame bind group entries (bindings 10..12).
   */
  public getFrameBindings(): {
    shadowMapView: GPUTextureView;
    shadowSampler: GPUSampler;
    shadowUniformBuffer: GPUBuffer;
  } {
    return {
      shadowMapView: this.shadowView,
      shadowSampler: this.shadowSampler,
      shadowUniformBuffer: this.shadowUniformBuffer,
    };
  }

  public writeDisabled(): void {
    // Zero sun contribution by setting intensity to 0 and neutral data.
    // Prepare an identity lightViewProj to avoid NaNs.
    const ident = mat4.identity();
    this.shadowUniformsData.fill(0);
    this.shadowUniformsData.set(ident, 0); // lightViewProj
    // lightDir, lightColor remain 0
    // params0: [intensity, pcfRadius, mapSize, depthBias] -> intensity = 0
    // leave others 0
    this.device.queue.writeBuffer(
      this.shadowUniformBuffer,
      0,
      this.shadowUniformsData,
    );
  }
}
