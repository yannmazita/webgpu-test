// src/core/shaders/unlit.wgsl

/*
 * Unlit shader that renders objects with their base color and/or texture,
 * without any lighting calculations.
 *
 * The shader organizes bindings into groups based on update frequency.
 *
 * @group(0) - Per-Frame Data
 *   - Updated once per frame.
 *   - Contains scene-level information like the camera.
 *   - Bindings:
 *     @binding(0): Camera Matrix Uniforms
 *
 * @group(1) - Per-Material Data
 *   - Updated for each distinct material.
 *   - Contains resources specific to the material being drawn.
 *   - Bindings:
 *     @binding(0): Base Color Texture
 *     @binding(1): Texture Sampler
 *     @binding(2): Material properties (base color)
 *
 * If vec3 data needs to be transfered between cpu-gpu, vec4 is used
 * to avoid padding shenanigans
 */

// Uniforms that are constant for the entire frame.
struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
};

// Uniforms for material properties.
struct MaterialUniforms {
    baseColor: vec4<f32>,
    hasTexture: f32, // using f32 as bools have complex padding rules
};

// @group(0) is for per-frame data.
@group(0) @binding(0)
var<uniform> camera: CameraUniforms;

// @group(1) is for per-material data.
@group(1) @binding(0)
var t_base: texture_2d<f32>;
@group(1) @binding(1)
var s_base: sampler;
@group(1) @binding(2)
var<uniform> u_material: MaterialUniforms;


// This struct defines the data that is passed from the vertex shader
// to the fragment shader. The GPU interpolates these values for each pixel.
struct VertexOutput {
    // The final position of the vertex in "clip space".
    @builtin(position) clip_position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
};

@vertex
fn vs_main(
    // Per-vertex attributes
    // The vertex buffer layout must match this. Normals are omitted.
    @location(0) inPos: vec3<f32>,
    @location(1) inTexCoords: vec2<f32>,

    // Per-instance attributes (model matrix)
    @location(2) model_mat_col_0: vec4<f32>,
    @location(3) model_mat_col_1: vec4<f32>,
    @location(4) model_mat_col_2: vec4<f32>,
    @location(5) model_mat_col_3: vec4<f32>,
) -> VertexOutput {
    var out: VertexOutput;

    let modelMatrix = mat4x4<f32>(
      model_mat_col_0, model_mat_col_1, model_mat_col_2, model_mat_col_3
    );

    // Transform vertex to clip space
    out.clip_position = camera.viewProjectionMatrix * modelMatrix * vec4<f32>(inPos, 1.0);
    out.tex_coords = inTexCoords;

    return out;
}


@fragment
fn fs_main(
    in: VertexOutput,
    @builtin(front_facing) face: bool
    ) -> @location(0) vec4<f32> {
    // Get Material Properties
    var finalColor = u_material.baseColor;
    if (u_material.hasTexture > 0.5) {
      let textureColor = textureSample(t_base, s_base, in.tex_coords);
      // Modulate texture color with material base color
      finalColor = finalColor * textureColor;
    }

    if (face) {
      return finalColor;
    }
    else {
      return vec4<f32>(0.0, 1.0, 0.0 ,1.0); // Green for back-faces
    }
}
