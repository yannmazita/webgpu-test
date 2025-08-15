// src/core/shaders/shaders.wgsl

// Uniforms that are constant for the entire frame (like camera matrices).
struct Camera {
    viewProjectionMatrix: mat4x4<f32>,
}

@group(0) @binding(0)
var<uniform> camera: Camera;

// Uniforms that change for each object being drawn.
struct Model {
    modelMatrix: mat4x4<f32>,
}
@group(1) @binding(0)
var<uniform> model: Model;


struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) tex_coords: vec2<f32>
};

@vertex
fn vs_main(
    @location(0) inPos: vec3<f32>,
    @location(1) inColor: vec3<f32>,
    @location(2) inTexCoords: vec2<f32>
) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = camera.viewProjectionMatrix * model.modelMatrix * vec4<f32>(inPos, 1.0);
    out.color = inColor;
    out.tex_coords = inTexCoords;
    return out;
}

// Bindings for material properties like textures and samplers.
@group(1) @binding(1)
var t_diffuse: texture_2d<f32>;
@group(1) @binding(2)
var s_diffuse: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let texture_color = textureSample(t_diffuse, s_diffuse, in.tex_coords);

    // use.rgb to ignore alpha from the texture and have a fixed 1.0 alpha.
    return vec4<f32>(texture_color.rgb * in.color, 1.0);
}
