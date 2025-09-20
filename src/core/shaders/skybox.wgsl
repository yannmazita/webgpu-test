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

    // Fullscreen triangle trick.
    let x = f32(in_vertex_index / 2u);
    let y = f32(in_vertex_index & 1u);
    let screen_pos = vec2<f32>(x * 4.0 - 1.0, y * 4.0 - 1.0);
    out.clip_position = vec4<f32>(screen_pos, 1.0, 1.0);

    // --- View direction calculation ---
    // We're calculating the world-space view direction
    // using only the camera's rotation

    // 1. Calculate the inverse projection matrix: inv(P) = V * inv(VP)
    let inv_view_proj = mat4_inverse(camera.viewProjectionMatrix);
    let inv_proj = camera.viewMatrix * inv_view_proj;

    // 2. Un-project the clip-space position to a point in view-space.
    let view_pos_h = inv_proj * out.clip_position;
    
    // 3. The direction in view-space is from the origin to this point.
    //    We don't normalize here; we do it per-fragment for better quality.
    let view_dir = view_pos_h.xyz / view_pos_h.w;

    // 4. Get the camera's world rotation matrix (the upper 3x3 of the view matrix,
    //    transposed, since inverse(rotation) = transpose(rotation)).
    let inv_view_mat3 = mat3x3<f32>(
        camera.viewMatrix[0].xyz,
        camera.viewMatrix[1].xyz,
        camera.viewMatrix[2].xyz
    );
    let world_rot_mat = transpose(inv_view_mat3);
    
    // 5. Transform the view-space direction into world-space.
    out.view_dir = world_rot_mat * view_dir;

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
