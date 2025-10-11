// src/core/shaders/skybox.wgsl
#include "utils.wgsl"

const PI: f32 = 3.141592653589793;

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

struct Cascade {
    lightViewProj: mat4x4<f32>,
    splitDepth: vec4<f32>, // Only .x is used.
};

struct ShadowUniforms {
    cascades: array<Cascade, 4>,
    lightDir: vec4<f32>,  // xyz used
    lightColor: vec4<f32>,  // rgb used
    params0: vec4<f32>, // intensity, pcfRadius, mapSize, depthBias
};


@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(2) var<uniform> scene: SceneUniforms;
@group(0) @binding(12) var<uniform> shadow: ShadowUniforms;

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
    let sky_sample = textureSample(skyboxTexture, skyboxSampler, view_dir);
    var color = sky_sample.rgb;
    
    // ===== Volumetric Fog =====
    if (scene.miscParams.x > 0.5) { // Check fogEnabled flag
        let y_cam = scene.cameraPos.y;
        let v_y = view_dir.y;

        let fog_density = scene.fogParams.x;
        let fog_height = scene.fogParams.y;
        let fog_falloff = scene.fogParams.z;
        let sun_inscatter_intensity = scene.fogParams.w;

        // For skybox, ray goes to "infinity". We need a different optical depth calculation.
        var optical_depth = 30.0; // A large number for rays pointing down or horizontally
        if (v_y > 0.0001 && fog_falloff > 0.0) {
            // For rays pointing up, the integral converges to a finite value.
            let term1 = exp(-fog_falloff * (y_cam - fog_height));
            optical_depth = max(0.0, fog_density * term1 / (fog_falloff * v_y));
        }
        
        let extinction = exp(-optical_depth);

        let sun_dir = normalize(-shadow.lightDir.xyz);
        let cos_angle = dot(view_dir, sun_dir);
        let g = 0.76; // Henyey-Greenstein phase function parameter
        let phase = (1.0 - g*g) / (4.0 * PI * pow(1.0 + g*g - 2.0*g*cos_angle, 1.5));

        // Sky is not shadowed by scene geometry, so shadowFactor is 1.0
        let sun_intensity = shadow.params0.x;
        let sun_inscattering = shadow.lightColor.rgb * sun_intensity * sun_inscatter_intensity * phase;
        let ambient_inscattering = scene.fogColor.rgb;
        let total_inscattering = sun_inscattering + ambient_inscattering;

        color = mix(total_inscattering, color, extinction);
    }
    
    // Conditionally apply tone mapping based on scene.miscParams.y
    var final_color = color;
    if (scene.miscParams.y > 0.5) {
        final_color = ACESFilmicToneMapping(color);
    }

    return vec4<f32>(final_color, sky_sample.a);
}
