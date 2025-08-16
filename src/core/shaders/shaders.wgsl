// src/core/shaders/shaders.wgsl

/*
 * The shader organizes bindings into groups based on update frequency
 * for performance.
 *
 * @group(0) - Per-Frame Data
 *   - Updated once per frame.
 *   - Contains scene-level information like the camera.
 *   - Bindings:
 *     @binding(0): Camera (View/Projection Matrix)
 *
 * @group(1) - Per-Material
 *   - Updated for each distinct material.
 *   - Contains resources specific to the material being drawn.
 *   - Bindings:
 *     @binding(0): Diffuse Texture
 *     @binding(1): Texture Sampler
 */

// Uniforms that are constant for the entire frame (like camera matrices).
struct Camera {
    viewProjectionMatrix: mat4x4<f32>,
}

// @group(0) is for per-frame data.
@group(0) @binding(0)
var<uniform> camera: Camera;

// This struct defines the data that is passed from the vertex shader
// to the fragment shader. The GPU interpolates these values for each pixel.
struct VertexOutput {
    // The final position of the vertex in "clip space". The GPU uses this
    // special built-in variable to perform rasterization.
    @builtin(position) clip_position: vec4<f32>,

    // The vertex color, passed to the fragment shader.
    @location(0) color: vec3<f32>,

    // The texture coordinates, passed to the fragment shader.
    @location(1) tex_coords: vec2<f32>
};

@vertex
fn vs_main(
    // These inputs correspond to the attributes in the vertex buffer layout.
    // @location(0) maps to shaderLocation: 0 (vertex position).
    @location(0) inPos: vec3<f32>,
    // @location(1) maps to shaderLocation: 1 (vertex color).
    @location(1) inColor: vec3<f32>,
    // @location(2) maps to shaderLocation: 2 (texture coordinates).
    @location(2) inTexCoords: vec2<f32>,

    // Per-instance attributes for the model matrix
    @location(3) model_mat_col_0: vec4<f32>,
    @location(4) model_mat_col_1: vec4<f32>,
    @location(5) model_mat_col_2: vec4<f32>,
    @location(6) model_mat_col_3: vec4<f32>,
) -> VertexOutput {
    var out: VertexOutput;
    // Reconstruct the model matrix from the instance attributes.
    let modelMatrix = mat4x4<f32>(
      model_mat_col_0,
      model_mat_col_1,
      model_mat_col_2,
      model_mat_col_3
    );

    // Transform the vertex position from model space -> world space -> clip space.
    out.clip_position = camera.viewProjectionMatrix * modelMatrix * vec4<f32>(inPos, 1.0);
    // Pass the color and texture coordinates through to the fragment shader.
    out.color = inColor;
    out.tex_coords = inTexCoords;
    return out;
}

// Bindings for material properties like textures and samplers.
@group(1) @binding(0)
var t_diffuse: texture_2d<f32>; // The object's diffuse texture.
@group(1) @binding(1)
var s_diffuse: sampler; // The sampler used to read from the texture.

@fragment
fn fs_main(
    // The 'in' parameter receives the interpolated values from the
    // VertexOutput struct for the current fragment (pixel).
    in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample the texture at the interpolated texture coordinates.
    let texture_color = textureSample(t_diffuse, s_diffuse, in.tex_coords);

    // Combine the texture color with the interpolated vertex color.
    // we use .rgb to ignore the texture's alpha channel to have a solid object.
    return vec4<f32>(texture_color.rgb * in.color, 1.0);
}
