// src/core/shaders/prefilter.wgsl
const PI: f32 = 3.141592653589793;

struct PrefilterParams {
    roughness: f32,
};

@group(0) @binding(0) var environmentMap: texture_cube<f32>;
@group(0) @binding(1) var environmentSampler: sampler;
@group(0) @binding(2) var prefilteredMap: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: PrefilterParams;

// From https://learnopengl.com/PBR/IBL/Specular-IBL
fn direction_for_face(face_index: u32, uv: vec2<f32>) -> vec3<f32> {
    var dir: vec3<f32>;
    switch (face_index) {
        case 0u: { dir = vec3<f32>(1.0, -uv.y, -uv.x); }
        case 1u: { dir = vec3<f32>(-1.0, -uv.y, uv.x); }
        case 2u: { dir = vec3<f32>(uv.x, 1.0, uv.y); }
        case 3u: { dir = vec3<f32>(uv.x, -1.0, -uv.y); }
        case 4u: { dir = vec3<f32>(uv.x, -uv.y, 1.0); }
        case 5u: { dir = vec3<f32>(-uv.x, -uv.y, -1.0); }
        default: { dir = vec3<f32>(0.0); }
    }
    return normalize(dir);
}

@compute @workgroup_size(8, 8, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let dims = textureDimensions(prefilteredMap);
    let face_size = dims.x;
    if (global_id.x >= face_size || global_id.y >= face_size) { return; }

    let face_index = global_id.z;
    let texel = vec2<f32>(global_id.xy);
    let uv_norm = (texel + vec2<f32>(0.5)) / f32(face_size) * 2.0 - 1.0;

    let N = direction_for_face(face_index, uv_norm);
    let R = N;
    let V = R;

    var up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(N.y) > 0.999) {
        up = vec3<f32>(1.0, 0.0, 0.0);
    }
    let right = normalize(cross(up, N));
    up = normalize(cross(N, right));

    var prefiltered_color = vec3<f32>(0.0);
    var total_weight = 0.0;

    let sample_count = 8192u;
    for (var i: u32 = 0u; i < sample_count; i = i + 1u) {
        let xi = hammersley(i, sample_count);
        let H = importance_sample_ggx(xi, N, params.roughness);
        let L = normalize(2.0 * dot(V, H) * H - V);
        let NdotL = max(dot(N, L), 0.0);
        if (NdotL > 0.0) {
            prefiltered_color += textureSampleLevel(environmentMap, environmentSampler, L, 0.0).rgb * NdotL;
            total_weight += NdotL;
        }
    }
    prefiltered_color = prefiltered_color / total_weight;

    textureStore(prefilteredMap, global_id.xy, face_index, vec4<f32>(prefiltered_color, 1.0));
}

// Low-discrepancy sequence for quasi-Monte Carlo
fn radical_inverse_vdc(bits: u32) -> f32 {
    var b = bits;
    b = (b << 16u) | (b >> 16u);
    b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
    b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
    b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
    b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
    return f32(b) * 2.3283064365386963e-10; // / 0x100000000
}

fn hammersley(i: u32, N: u32) -> vec2<f32> {
    return vec2<f32>(f32(i) / f32(N), radical_inverse_vdc(i));
}

fn importance_sample_ggx(xi: vec2<f32>, N: vec3<f32>, roughness: f32) -> vec3<f32> {
    let a = roughness * roughness;
    let phi = 2.0 * PI * xi.x;
    let cos_theta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sin_theta = sqrt(1.0 - cos_theta * cos_theta);

    let H = vec3<f32>(
        cos(phi) * sin_theta,
        sin(phi) * sin_theta,
        cos_theta
    );

    var up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(N.z) > 0.999) {
        up = vec3<f32>(1.0, 0.0, 0.0);
    }
    let tangent = normalize(cross(up, N));
    let bitangent = cross(N, tangent);
    
    let sample_vec = tangent * H.x + bitangent * H.y + N * H.z;
    return normalize(sample_vec);
}
