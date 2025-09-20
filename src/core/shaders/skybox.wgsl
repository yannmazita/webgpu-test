// src/core/shaders/skybox.wgsl
#include "utils.wgsl"

struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    inverseViewProjectionMatrix: mat4x4<f32>,
}

struct SceneUniforms {
    cameraPos: vec4<f32>,
    fogColor: vec4<f32>,
    fogParams: vec4<f32>,       // [density, height, heightFalloff, inscatteringIntensity]
    miscParams: vec4<f32>,      // [fogEnabled, hdrEnabled, prefilteredMipLevels, pad]
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(2) var<uniform> scene: SceneUniforms;

@group(1) @binding(0) var skyboxTexture: texture_cube<f32>;
@group(1) @binding(1) var skyboxSampler: sampler;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) view_dir: vec3<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;

    // Fullscreen triangle trick
    let x = f32(in_vertex_index / 2u);
    let y = f32(in_vertex_index & 1u);
    let screen_pos = vec2<f32>(x * 4.0 - 1.0, y * 4.0 - 1.0);
    let clip = vec4<f32>(screen_pos, 1.0, 1.0);

    // Unproject to world space using inverseViewProjection
    let world_h = camera.inverseViewProjectionMatrix * clip;
    let world = world_h.xyz / world_h.w;

    // Build view direction in world-space using camera position from SceneUniforms
    out.view_dir = world - scene.cameraPos.xyz;

    // Standard position for fullscreen triangle
    out.clip_position = clip;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Normalize the interpolated view direction per-fragment to fix distortion.
    let view_dir = normalize(in.view_dir);
    
    // Sample the cubemap with the corrected view direction.
    var color = textureSample(skyboxTexture, skyboxSampler, view_dir);
    
    // Conditionally apply tone mapping based on scene.miscParams.y
    var final_color = color.rgb;
    if (scene.miscParams.y > 0.5) {
        final_color = ACESFilmicToneMapping(color.rgb);
    }

    return vec4<f32>(final_color, color.a);
}
