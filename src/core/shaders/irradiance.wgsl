// src/core/shaders/irradiance.wgsl
const PI: f32 = 3.141592653589793;

@group(0) @binding(0) var environmentMap: texture_cube<f32>;
@group(0) @binding(1) var environmentSampler: sampler;
@group(0) @binding(2) var irradianceMap: texture_storage_2d_array<rgba16float, write>;

// From https://learnopengl.com/PBR/IBL/Diffuse-irradiance
fn direction_for_face(face_index: u32, uv: vec2<f32>) -> vec3<f32> {
    var dir: vec3<f32>;
    switch (face_index) {
        case 0u: { // +X
            dir = vec3<f32>(1.0, -uv.y, -uv.x);
        }
        case 1u: { // -X
            dir = vec3<f32>(-1.0, -uv.y, uv.x);
        }
        case 2u: { // +Y
            dir = vec3<f32>(uv.x, 1.0, uv.y);
        }
        case 3u: { // -Y
            dir = vec3<f32>(uv.x, -1.0, -uv.y);
        }
        case 4u: { // +Z
            dir = vec3<f32>(uv.x, -uv.y, 1.0);
        }
        case 5u: { // -Z
            dir = vec3<f32>(-uv.x, -uv.y, -1.0);
        }
        default: {
            dir = vec3<f32>(0.0);
        }
    }
    return normalize(dir);
}

@compute @workgroup_size(8, 8, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let dims = textureDimensions(irradianceMap);
    let face_size = dims.x;
    if (global_id.x >= face_size || global_id.y >= face_size) {
        return;
    }

    let face_index = global_id.z;
    let texel = vec2<f32>(global_id.xy);
    let uv_norm = (texel + vec2<f32>(0.5)) / f32(face_size) * 2.0 - 1.0;

    let N = direction_for_face(face_index, uv_norm);

    // Create basis vectors for hemisphere sampling
    var up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(N.y) > 0.999) {
        up = vec3<f32>(1.0, 0.0, 0.0);
    }
    let right = normalize(cross(up, N));
    up = normalize(cross(N, right));

    var irradiance = vec3<f32>(0.0);
    let sample_count = 1024u;
    let inv_sample_count = 1.0 / f32(sample_count);

    for (var i: u32 = 0u; i < sample_count; i = i + 1u) {
        // Monte Carlo sampling
        let xi = hammersley(i, sample_count);
        let H = hemisphere_sample_uniform(xi);

        let L = right * H.x + up * H.y + N * H.z;
        let NdotL = max(dot(N, L), 0.0);

        if (NdotL > 0.0) {
            irradiance += textureSample(environmentMap, environmentSampler, L).rgb * NdotL;
        }
    }
    irradiance = PI * irradiance * inv_sample_count;

    textureStore(irradianceMap, global_id.xy, face_index, vec4<f32>(irradiance, 1.0));
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

fn hemisphere_sample_uniform(xi: vec2<f32>) -> vec3<f32> {
    let phi = xi.y * 2.0 * PI;
    let cos_theta = 1.0 - xi.x;
    let sin_theta = sqrt(1.0 - cos_theta * cos_theta);
    return vec3<f32>(cos(phi) * sin_theta, sin(phi) * sin_theta, cos_theta);
}
