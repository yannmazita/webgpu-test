// src/core/shaders/unlitGround.wgsl
// Frame-level uniforms
struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
}

struct UnlitSkyboxMaterialUniforms {
    color: vec4<f32>,
    use_texture: f32, // 1.0 for texture, 0.0 for color
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;

@group(1) @binding(0) var unlitTexture: texture_2d<f32>;
@group(1) @binding(1) var unlitSampler: sampler;
@group(1) @binding(2) var<uniform> material: UnlitSkyboxMaterialUniforms;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) texCoords: vec2<f32>,
}

@vertex
fn vs_main(
    @location(0) inPos: vec3<f32>,
    @location(1) inNormal: vec3<f32>,
    @location(2) inTexCoords: vec2<f32>,
    @location(4) model_mat_col_0: vec4<f32>,
    @location(5) model_mat_col_1: vec4<f32>,
    @location(6) model_mat_col_2: vec4<f32>,
    @location(7) model_mat_col_3: vec4<f32>
) -> VertexOutput {
    var out: VertexOutput;

    let modelMatrix = mat4x4<f32>(
        model_mat_col_0, model_mat_col_1, model_mat_col_2, model_mat_col_3
    );
    let worldPos = modelMatrix * vec4<f32>(inPos, 1.0);

    out.clip_position = camera.viewProjectionMatrix * worldPos;
    out.texCoords = inTexCoords;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    if (material.use_texture > 0.5) {
        return textureSample(unlitTexture, unlitSampler, in.texCoords);
    } else {
        return material.color;
    }
}
