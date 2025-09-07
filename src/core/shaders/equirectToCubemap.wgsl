// src/core/shaders/equirectToCubemap.wgsl
const PI: f32 = 3.141592653589793;

@group(0) @binding(0) var equirectangularTexture: texture_2d<f32>;
@group(0) @binding(1) var cubemapTexture: texture_storage_2d_array<rgba16float, write>;

// Converts a 3D direction vector to a 2D UV coordinate on an equirectangular map.
fn directionToUV(dir: vec3<f32>) -> vec2<f32> {
    let d = normalize(dir);
    // atan2(z, x) gives the angle in the XZ plane (longitude)
    // asin(y) gives the angle from the XZ plane (latitude)
    return vec2<f32>(
        0.5 + atan2(d.z, d.x) / (2.0 * PI),
        0.5 - asin(d.y) / PI
    );
}

@compute @workgroup_size(8, 8, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let dims = textureDimensions(cubemapTexture);
    let faceSize = dims.x;
    if (global_id.x >= faceSize || global_id.y >= faceSize) {
        return;
    }

    let faceIndex = global_id.z;
    let texel = vec2<f32>(global_id.xy);

    // Convert texel coordinate to [-1, 1] range for the current face
    let uv = (texel + vec2<f32>(0.5)) / f32(faceSize) * 2.0 - 1.0;

    var dir: vec3<f32>;
    switch (faceIndex) {
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
             // Should not happen
            dir = vec3<f32>(0.0);
        }
    }

    // Convert the direction vector to a UV on the equirectangular map
    let equirectUV = directionToUV(dir);

    // Sample the equirectangular texture
    let dims_f = vec2<f32>(textureDimensions(equirectangularTexture));
    let color = textureLoad(
        equirectangularTexture, 
        vec2<i32>(floor(equirectUV * dims_f)),
        0
    );

    // Write the color to the corresponding face of the cubemap
    textureStore(cubemapTexture, global_id.xy, faceIndex, color);
}
