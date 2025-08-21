// src/core/shaders/shaders.wgsl

/*
 * The shader organizes bindings into groups based on update frequency.
 *
 * @group(0) - Per-Frame Data
 *   - Updated once per frame.
 *   - Contains scene-level information like the camera and lighting.
 *   - Bindings:
 *     @binding(0): Camera Matrix Uniforms
 *     @binding(1): Scene Uniforms (lighting, camera position)
 *
 * @group(1) - Per-Material Data
 *   - Updated for each distinct material.
 *   - Contains resources specific to the material being drawn.
 *   - Bindings:
 *     @binding(0): Diffuse Texture
 *     @binding(1): Texture Sampler
 *     @binding(2): Material properties (colors, shininess)
 */

// Uniforms that are constant for the entire frame.
struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
};

struct SceneUniforms {
    lightPos: vec3<f32>,
    // padding
    lightColor: vec3<f32>,
    // padding
    cameraPos: vec3<f32>,
};

// Uniforms for material properties.
struct MaterialUniforms {
    baseColor: vec4<f32>,
    specularColor: vec3<f32>,
    shininess: f32,
    hasTexture: f32, // using f32 as bools have complex padding rules
};


// @group(0) is for per-frame data.
@group(0) @binding(0)
var<uniform> camera: CameraUniforms;
@group(0) @binding(1)
var<uniform> scene: SceneUniforms;

// @group(1) is for per-material data.
@group(1) @binding(0)
var t_diffuse: texture_2d<f32>;
@group(1) @binding(1)
var s_diffuse: sampler;
@group(1) @binding(2)
var<uniform> u_material: MaterialUniforms;


// This struct defines the data that is passed from the vertex shader
// to the fragment shader. The GPU interpolates these values for each pixel.
struct VertexOutput {
    // The final position of the vertex in "clip space".
    @builtin(position) clip_position: vec4<f32>,

    // Pass world-space data to the fragment shader for lighting calculations.
    @location(0) worldNormal: vec3<f32>,
    @location(1) worldPosition: vec3<f32>,
    @location(2) tex_coords: vec2<f32>,
};

@vertex
fn vs_main(
    // Per-vertex attributes
    @location(0) inPos: vec3<f32>,
    @location(1) inNormal: vec3<f32>,
    @location(2) inTexCoords: vec2<f32>,

    // Per-instance attributes
    @location(3) model_mat_col_0: vec4<f32>,
    @location(4) model_mat_col_1: vec4<f32>,
    @location(5) model_mat_col_2: vec4<f32>,
    @location(6) model_mat_col_3: vec4<f32>,
    @location(7) normal_mat_col_0: vec4<f32>,
    @location(8) normal_mat_col_1: vec4<f32>,
    @location(9) normal_mat_col_2: vec4<f32>,
    @location(10) normal_mat_col_3: vec4<f32>,
) -> VertexOutput {
    var out: VertexOutput;

    let modelMatrix = mat4x4<f32>(
      model_mat_col_0, model_mat_col_1, model_mat_col_2, model_mat_col_3
    );

    let normalMatrix = mat4x4<f32>(
      normal_mat_col_0, normal_mat_col_1, normal_mat_col_2, normal_mat_col_3
    );

    // Transform vertex position and normal to world space
    let worldPos4 = modelMatrix * vec4<f32>(inPos, 1.0);
    out.worldPosition = worldPos4.xyz;
    out.worldNormal = normalize((normalMatrix * vec4<f32>(inNormal, 0.0)).xyz);

    // Transform vertex to clip space
    out.clip_position = camera.viewProjectionMatrix * worldPos4;

    // Pass texture coordinates through
    out.tex_coords = inTexCoords;

    return out;
}


@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Get Material Properties
    var baseColor = u_material.baseColor;
    if (u_material.hasTexture > 0.5) {
      let textureColor = textureSample(t_diffuse, s_diffuse, in.tex_coords);
      // Modulate texture color with material base color
      baseColor = baseColor * textureColor;
    }

    // Prepare Vectors for Lighting
    // The interpolated normal needs to be re-normalized in the fragment shader.
    let normal = normalize(in.worldNormal);
    let viewDir = normalize(scene.cameraPos - in.worldPosition);
    let lightDir = normalize(scene.lightPos - in.worldPosition);

    // Phong Ambient Component
    // A constant low-intensity light to simulate indirect illumination.
    let ambientStrength = 0.1;
    let ambient = ambientStrength * scene.lightColor;

    // Phong Diffuse Component
    // Simulates light scattering on matte surfaces.
    // Depends on the angle between the light and the surface normal.
    let diff = max(dot(normal, lightDir), 0.0);
    let diffuse = diff * scene.lightColor;

    // Phong Specular Component
    // Simulates reflections on shiny surfaces.
    // Depends on the view direction and the light's reflection direction.
    let reflectDir = reflect(-lightDir, normal);
    let spec = pow(max(dot(viewDir, reflectDir), 0.0), u_material.shininess);
    let specular = u_material.specularColor * spec * scene.lightColor;

    // Combine Components
    // The final color is the sum of ambient and diffuse light, modulated by the
    // object base color, plus the specular highlights.
    let finalColor = (ambient + diffuse) * baseColor.rgb + specular;

    return vec4<f32>(finalColor, baseColor.a);
}
