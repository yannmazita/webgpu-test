// src/core/shaders/brdf_lookup_table.wgsl
const PI: f32 = 3.141592653589793;

@group(0) @binding(0) var outputTexture: texture_storage_2d<rg16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let dims = textureDimensions(outputTexture);
    if (global_id.x >= dims.x || global_id.y >= dims.y) {
        return;
    }

    let frag_coord = vec2<f32>(global_id.xy) + vec2<f32>(0.5);
    let uv = frag_coord / vec2<f32>(dims);
    
    let NdotV = uv.x;
    let roughness = uv.y;
    let V = vec3<f32>(sqrt(1.0 - NdotV * NdotV), 0.0, NdotV);

    var A = 0.0;
    var B = 0.0;

    let N = vec3<f32>(0.0, 0.0, 1.0);
    let sample_count = 1024u;

    for (var i: u32 = 0u; i < sample_count; i = i + 1u) {
        let xi = hammersley(i, sample_count);
        let H = importance_sample_ggx(xi, N, roughness);
        let L = normalize(2.0 * dot(V, H) * H - V);

        let NdotL = max(L.z, 0.0);
        let NdotH = max(H.z, 0.0);
        let VdotH = max(dot(V, H), 0.0);

        if (NdotL > 0.0) {
            let G = geometry_smith(N, V, L, roughness);
            let G_Vis = (G * VdotH) / (NdotH * NdotV);
            let Fc = pow(1.0 - VdotH, 5.0);
            A += (1.0 - Fc) * G_Vis;
            B += Fc * G_Vis;
        }
    }
    A /= f32(sample_count);
    B /= f32(sample_count);

    textureStore(outputTexture, global_id.xy, vec4<f32>(A, B, 0.0, 1.0));
}

fn geometry_schlick_ggx(NdotV: f32, roughness: f32) -> f32 {
    let a = roughness;
    let k = (a * a) / 2.0;
    let num = NdotV;
    let den = NdotV * (1.0 - k) + k;
    return num / den;
}

fn geometry_smith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx2 = geometry_schlick_ggx(NdotV, roughness);
    let ggx1 = geometry_schlick_ggx(NdotL, roughness);
    return ggx1 * ggx2;
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
