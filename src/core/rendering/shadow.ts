// src/core/rendering/shadow.ts
import shadowVsUrl from "@/core/shaders/shadow.wgsl?url";
import { ShaderPreprocessor } from "@/core/shaders/preprocessor";
import { Mesh, Renderable } from "@/core/types/gpu";
import { CameraComponent } from "@/core/ecs/components/cameraComponent";
import {
  SceneSunComponent,
  ShadowSettingsComponent,
} from "@/core/ecs/components/sunComponent";
import { mat4, Mat4, vec3, Vec3 } from "wgpu-matrix";
import { Renderer } from "../renderer";

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

  // Cached params
  private mapSize = 2048;
  private shadowUniformsData = new Float32Array(36); // 4x4 + 3 vec4 = 16 + 12 = 28 floats, pad to multiple of 4

  // Temp matrices/vectors
  private lightView: Mat4 = mat4.identity();
  private lightProj: Mat4 = mat4.identity();
  private lightViewProj: Mat4 = mat4.identity();
  private tmpUp: Vec3 = vec3.fromValues(0, 1, 0);

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
    frameBgl: GPUBindGroupLayout,
    meshLayouts: GPUVertexBufferLayout[],
    instanceLayout: GPUVertexBufferLayout,
    depthFormat: GPUTextureFormat = "depth32float",
  ): Promise<void> {
    // Will (re)create when map size changes
    this.createShadowResources(this.mapSize, depthFormat);

    const code = await this.pre.process(shadowVsUrl);
    const module = this.device.createShaderModule({
      label: "SHADOW_DEPTH_ONLY_MODULE",
      code,
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "SHADOW_PIPELINE_LAYOUT",
      bindGroupLayouts: [frameBgl],
    });

    // Vertex buffers = mesh buffers + instance buffer at the end
    const buffers: GPUVertexBufferLayout[] = [];
    for (let i = 0; i < meshLayouts.length; i++) buffers.push(meshLayouts[i]);
    buffers.push(instanceLayout);

    this.pipeline = this.device.createRenderPipeline({
      label: "SHADOW_DEPTH_ONLY_PIPELINE",
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers,
      },
      // No fragment stage: depth-only
      primitive: {
        topology: "triangle-list",
        cullMode: "front", // reduce acne
      },
      depthStencil: {
        format: depthFormat,
        depthCompare: "less",
        depthWriteEnabled: true,
        depthBias: 1, // will be tuned each frame via settings (set in render pass state not possible; keep conservative here)
        depthBiasSlopeScale: 1, // pipeline-level defaults; slope bias set in pass via settings is not supported, so keep conservative
      },
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
   * Updates sun shadow matrices and uniforms.
   */
  public updatePerFrame(
    camera: CameraComponent,
    sun: SceneSunComponent,
    settings: ShadowSettingsComponent,
  ): void {
    if (settings.mapSize !== this.mapSize) {
      this.mapSize = settings.mapSize;
      this.createShadowResources(this.mapSize, "depth32float");
    }

    // Compute light position from camera center for stability.
    // Look from camera center toward -sun.direction at some distance proportional to ortho size.
    const camPos = vec3.fromValues(
      camera.inverseViewMatrix[12],
      camera.inverseViewMatrix[13],
      camera.inverseViewMatrix[14],
    );
    const dir = vec3.normalize(sun.direction);
    const lightDist = settings.orthoHalfExtent * 2.0;
    const eye = vec3.fromValues(
      camPos[0] - dir[0] * lightDist,
      camPos[1] - dir[1] * lightDist,
      camPos[2] - dir[2] * lightDist,
    );
    const target = camPos;

    mat4.lookAt(
      eye,
      target,
      Math.abs(dir[1]) > 0.95 ? vec3.fromValues(1, 0, 0) : this.tmpUp,
      this.lightView,
    );

    const h = settings.orthoHalfExtent;
    // Orthographic projection in light space covering a fixed box around the camera
    mat4.ortho(-h, h, -h, h, 0.1, lightDist * 4.0, this.lightProj);

    mat4.multiply(this.lightProj, this.lightView, this.lightViewProj);

    // Pack uniforms: mat4 + (lightDir, color), params0(intensity, pcfRadius, mapSize, depthBias)
    this.shadowUniformsData.set(this.lightViewProj, 0);
    this.shadowUniformsData.set([dir[0], dir[1], dir[2], 0.0], 16);
    // color rgb in xyz, intensity in w
    this.shadowUniformsData.set(
      [sun.color[0], sun.color[1], sun.color[2], sun.color[3]],
      20,
    );
    this.shadowUniformsData.set(
      [sun.color[3], settings.pcfRadius, this.mapSize, settings.depthBias],
      24,
    );
    this.device.queue.writeBuffer(
      this.shadowUniformBuffer,
      0,
      this.shadowUniformsData,
    );
  }

  /**
   * Records the shadow depth pass for all shadow-casting renderables.
   * Uses the shared instance buffer. Expects the caller to have written instance data.
   */
  public recordShadowPass(
    encoder: GPUCommandEncoder,
    frameBindGroup: GPUBindGroup,
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
    pass.setBindGroup(0, frameBindGroup);
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
        i * Renderer.INSTANCE_BYTE_STRIDE,
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
}
