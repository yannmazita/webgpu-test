// src/core/shaders/phong.wgsl
#include "utils.wgsl"

/*
 * The shader organizes bindings into groups based on update frequency.
 *
 * @group(0) - Per-Frame Data
 *   - Updated once per frame.
 *   - Contains scene-level information like the camera and lighting.
 *   - Bindings:
 *     @binding(0): Camera Matrix Uniforms
 *     @binding(1): Lights storage
 *     @binding(2): Scene Uniforms (camera position)
 *
 * @group(1) - Per-Material Data
 *   - Updated for each distinct material.
 *   - Contains resources specific to the material being drawn.
 *   - Bindings:
 *     @binding(0): Diffuse Texture
 *     @binding(1): Texture Sampler
 *     @binding(2): Material properties (colors, shininess)
 *
 * If vec3 data needs to be transfered between cpu-gpu, vec4 is used
 * to avoid padding shenanigans
 */

// Uniforms that are constant for the entire frame.
struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
};

struct SceneUniforms {
    cameraPos: vec4<f32>,
    ambientColor: vec4<f32>,
};

// Uniforms for material properties.
struct MaterialUniforms {
    baseColor: vec4<f32>,
    specularColor: vec4<f32>,
    shininess: f32,
    hasTexture: f32, // using f32 as bools have complex padding rules
};

// A struct to represent a single light source.
// We use vec4 for position and color to ensure 16-byte alignment within the array.
struct Light {
    position: vec4<f32>,
    color: vec4<f32>,
};

// A struct for the storage buffer containing all lights.
struct LightsBuffer {
    count: u32,
    lights: array<Light>,
};

// @group(0) is for per-frame data.
@group(0) @binding(0)
var<uniform> camera: CameraUniforms;
@group(0) @binding(1)
var<storage, read> lightsBuffer: LightsBuffer;
@group(0) @binding(2)
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

    // Per-instance attributes (model matrix)
    @location(3) model_mat_col_0: vec4<f32>,
    @location(4) model_mat_col_1: vec4<f32>,
    @location(5) model_mat_col_2: vec4<f32>,
    @location(6) model_mat_col_3: vec4<f32>,
    @location(7) is_uniformly_scaled: f32,
) -> VertexOutput {
    var out: VertexOutput;

    let modelMatrix = mat4x4<f32>(
      model_mat_col_0, model_mat_col_1, model_mat_col_2, model_mat_col_3
    );
    // Create the normal matrix on the GPU.
    // We only need the upper 3x3 part for transforming normals.
    let modelMatrix3x3 = mat3x3<f32>(
        modelMatrix[0].xyz,
        modelMatrix[1].xyz,
        modelMatrix[2].xyz
    );

    var normalMatrix: mat3x3<f32>;
    // If scaling is uniform, we can use the model matrix directly.
    // This avoids a very expensive inverse-transpose calculation.
    // Otherwise, we must compute the full normal matrix for correctness.
    if (is_uniformly_scaled > 0.5) {
      normalMatrix = modelMatrix3x3;
    } else {
      normalMatrix = transpose(mat3_inverse(modelMatrix3x3));
    }

    // Transform vertex position and normal to world space
    let worldPos4 = modelMatrix * vec4<f32>(inPos, 1.0);
    out.worldPosition = worldPos4.xyz;
    out.worldNormal = normalize(normalMatrix * inNormal);

    // Transform vertex to clip space
    out.clip_position = camera.viewProjectionMatrix * worldPos4;

    // Pass texture coordinates through
    out.tex_coords = inTexCoords;

    return out;
}


@fragment
fn fs_main(
    in: VertexOutput,
    @builtin(front_facing) face: bool
    ) -> @location(0) vec4<f32> {
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
    let viewDir = normalize(scene.cameraPos.xyz - in.worldPosition);

    // Initialize lighting components
    var totalDiffuse = vec3<f32>(0.0, 0.0, 0.0);
    var totalSpecular = vec3<f32>(0.0, 0.0, 0.0);

    // Loop through all active lights
    for (var i: u32 = 0u; i < lightsBuffer.count; i = i + 1u) {
        let currentLight = lightsBuffer.lights[i];
        let lightDir = normalize(currentLight.position.xyz - in.worldPosition);

        // Phong diffuse component
        let diff = max(dot(normal, lightDir), 0.0);
        totalDiffuse = totalDiffuse + (diff * currentLight.color.rgb);

        // Phong specular component
        let reflectDir = reflect(-lightDir, normal);
        let spec = pow(max(dot(viewDir, reflectDir), 0.0), u_material.shininess);
        totalSpecular = totalSpecular + (u_material.specularColor.rgb * spec * currentLight.color.rgb);
    }

    // Phong ambient component
    let ambient = scene.ambientColor.rgb;

    // Combine Components
    // The final color is the sum of ambient and total diffuse light, modulated by the
    // object base color, plus the total specular highlights.
    let finalColor = (ambient + totalDiffuse) * baseColor.rgb + totalSpecular;

    if (face) {
      return vec4<f32>(finalColor, baseColor.a);
    }
    else {
      return vec4<f32>(0.0, 1.0, 0.0 ,1.0); // Green for back-faces
    }
}
