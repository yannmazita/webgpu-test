// src/core/shaders/skybox.wgsl
#include "utils.wgsl"

struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
    // only need the view matrix for the skybox
    // updating the CameraUniforms struct in the renderer later.
    viewMatrix: mat4x4<f32>,
}

struct SceneUniforms {
    cameraPos: vec4<f32>,
    ambientColor: vec4<f32>,
    fogColor: vec4<f32>,
    fogParams0: vec4<f32>,
    fogParams1: vec4<f32>,
    hdr_enabled: f32, // 1.0 if HDR is on, 0.0 otherwise
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

    // A fullscreen triangle trick. No vertex buffer needed.
    let x = f32(in_vertex_index / 2u);
    let y = f32(in_vertex_index & 1u);
    let screen_pos = vec2<f32>(x * 4.0 - 1.0, y * 4.0 - 1.0);

    // Use a 1.0 z-value to ensure the skybox is always at the far plane.
    out.clip_position = vec4<f32>(screen_pos, 1.0, 1.0);

    // Using the inverse view matrix to transform the clip-space position 
    // back into a direction (simple way to unproject and get the world-space 
    // view direction for a skybox)
    
    // The camera's world position is the 4th column of the inverse view matrix.
    let inv_view = mat4_inverse(camera.viewMatrix);
    let camera_pos = inv_view[3].xyz;

    let inv_view_proj = mat4_inverse(camera.viewProjectionMatrix);
    let world_pos = inv_view_proj * out.clip_position;

    out.view_dir = normalize(world_pos.xyz / world_pos.w - camera_pos);

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample the cubemap with the view direction.
    var color = textureSample(skyboxTexture, skyboxSampler, in.view_dir);
    
    // If HDR is not enabled, we must tone map the color to the SDR range.
    if (scene.hdr_enabled < 0.5) {
        color = vec4<f32>(ACESFilmicToneMapping(color.rgb), color.a);
    }

    return color;
}
