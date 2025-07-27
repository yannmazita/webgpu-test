// src/core/shaders/shaders.wgsl
struct Uniforms {
    modelViewProjectionMatrix: mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>
};

@vertex
fn vs_main(
    @location(0) inPos: vec3<f32>,
    @location(1) inColor: vec3<f32>
) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = uniforms.modelViewProjectionMatrix * vec4<f32>(inPos, 1.0);
    out.color = inColor;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
