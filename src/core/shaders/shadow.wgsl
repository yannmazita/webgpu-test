// src/core/shaders/shadow.wgsl
// Depth-only pass: transform positions by light view-projection.

struct Cascade {
    lightViewProj: mat4x4<f32>,
    splitDepth: vec4<f32>, // Only .x is used.
};

struct ShadowUniforms {
    cascade: Cascade,
    lightDir: vec4<f32>,
    lightColor: vec4<f32>,
    params0: vec4<f32>,
};

@group(0) @binding(0) var<uniform> shadow: ShadowUniforms;

struct VSOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) inPos: vec3<f32>,
  // Instance data matches Renderer.INSTANCE_DATA_LAYOUT
  @location(4) m0: vec4<f32>,
  @location(5) m1: vec4<f32>,
  @location(6) m2: vec4<f32>,
  @location(7) m3: vec4<f32>,
  @location(8) is_uniform: u32
) -> VSOut {
  var out: VSOut;
  let model = mat4x4<f32>(m0, m1, m2, m3);
  let worldPos = model * vec4<f32>(inPos, 1.0);
  out.position = shadow.cascade.lightViewProj * worldPos;
  return out;
}
