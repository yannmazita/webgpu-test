#include "utils.wgsl"

// Frame-level uniforms
struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
}

struct SceneUniforms {
    cameraPos: vec4<f32>,
    ambientColor: vec4<f32>,
}

struct Light {
    position: vec4<f32>,
    color: vec4<f32>,
}

struct LightsBuffer {
    count: u32,
    lights: array<Light>,
}

// PBR Material uniforms
struct PBRMaterialUniforms {
    albedo: vec4<f32>,
    metallicRoughnessNormalOcclusion: vec4<f32>, // metallic, roughness, normalIntensity, occlusionStrength
    emissive: vec4<f32>,
    textureFlags: vec4<f32>, // hasAlbedo, hasMetallicRoughness, hasNormal, hasEmissive
}

// @group(0) - Per-frame data
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightsBuffer: LightsBuffer;
@group(0) @binding(2) var<uniform> scene: SceneUniforms;

// @group(1) - Per-material data
@group(1) @binding(0) var albedoTexture: texture_2d<f32>;
@group(1) @binding(1) var metallicRoughnessTexture: texture_2d<f32>;
@group(1) @binding(2) var normalTexture: texture_2d<f32>;
@group(1) @binding(3) var emissiveTexture: texture_2d<f32>;
@group(1) @binding(4) var occlusionTexture: texture_2d<f32>;
@group(1) @binding(5) var materialSampler: sampler;
@group(1) @binding(6) var<uniform> material: PBRMaterialUniforms;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) worldPosition: vec3<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) worldTangent: vec3<f32>,
    @location(3) worldBitangent: vec3<f32>,
    @location(4) texCoords: vec2<f32>,
}

@vertex
fn vs_main(
    @location(0) inPos: vec3<f32>,
    @location(1) inNormal: vec3<f32>,
    @location(2) inTexCoords: vec2<f32>,
    @location(3) model_mat_col_0: vec4<f32>,
    @location(4) model_mat_col_1: vec4<f32>,
    @location(5) model_mat_col_2: vec4<f32>,
    @location(6) model_mat_col_3: vec4<f32>,
    @location(7) is_uniformly_scaled: f32,
    @location(8) normal_mat_col_0: vec3<f32>,
    @location(9) normal_mat_col_1: vec3<f32>,
    @location(10) normal_mat_col_2: vec3<f32>,
) -> VertexOutput {
    var out: VertexOutput;

    let modelMatrix = mat4x4<f32>(
        model_mat_col_0, model_mat_col_1, model_mat_col_2, model_mat_col_3
    );

    // Transform position
    let worldPos4 = modelMatrix * vec4<f32>(inPos, 1.0);
    out.worldPosition = worldPos4.xyz;
    out.clip_position = camera.viewProjectionMatrix * worldPos4;
    out.texCoords = inTexCoords;

    // Transform normal
    var worldNormal: vec3<f32>;
    if (is_uniformly_scaled > 0.5) {
        let modelMatrix3x3 = mat3x3<f32>(
            modelMatrix[0].xyz,
            modelMatrix[1].xyz,
            modelMatrix[2].xyz
        );
        worldNormal = normalize(modelMatrix3x3 * inNormal);
    } else {
        let normalMatrix = mat3x3<f32>(
            normal_mat_col_0,
            normal_mat_col_1,
            normal_mat_col_2
        );
        worldNormal = normalize(normalMatrix * inNormal);
    }
    out.worldNormal = worldNormal;

    // Generate tangent and bitangent for normal mapping
    // Simple approach: derive from normal and a reference vector
    let up = vec3<f32>(0.0, 1.0, 0.0);
    let right = vec3<f32>(1.0, 0.0, 0.0);
    
    // Choose the vector that's least parallel to the normal
    let testDot = abs(dot(worldNormal, up));
    let reference = select(up, right, testDot > 0.9);
    
    out.worldTangent = normalize(cross(worldNormal, reference));
    out.worldBitangent = normalize(cross(worldNormal, out.worldTangent));

    return out;
}

// ===== PBR BRDF Functions =====

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH2 = NdotH * NdotH;
    let num = a2;
    var denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = 3.14159265 * denom * denom;
    return num / max(denom, 0.0001);
}

fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = (roughness + 1.0);
    let k = (r * r) / 8.0;
    let num = NdotV;
    let denom = NdotV * (1.0 - k) + k;
    return num / max(denom, 0.0001);
}

fn geometrySmith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx2 = geometrySchlickGGX(NdotV, roughness);
    let ggx1 = geometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Enhanced fresnel with roughness for IBL
fn fresnelSchlickRoughness(cosTheta: f32, F0: vec3<f32>, roughness: f32) -> vec3<f32> {
    let oneMinusRoughness = vec3<f32>(1.0 - roughness);
    return F0 + (max(oneMinusRoughness, F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Unpack normal from normal map
fn getNormalFromMap(in: VertexOutput, normalIntensity: f32) -> vec3<f32> {
    if (material.textureFlags.z < 0.5) {
        return normalize(in.worldNormal);
    }

    let tangentNormal = textureSample(normalTexture, materialSampler, in.texCoords).xyz * 2.0 - 1.0;
    
    // Apply normal intensity
    var adjustedNormal = tangentNormal;
    adjustedNormal.x *= normalIntensity;
    adjustedNormal.y *= normalIntensity;
    adjustedNormal = normalize(adjustedNormal);

    let N = normalize(in.worldNormal);
    let T = normalize(in.worldTangent);
    let B = normalize(in.worldBitangent);
    
    // Ensure proper handedness
    let TBN = mat3x3<f32>(T, B, N);
    return normalize(TBN * adjustedNormal);
}

// Calculate lighting contribution from a single light
fn calculateLightContribution(
    L: vec3<f32>,
    N: vec3<f32>, 
    V: vec3<f32>, 
    F0: vec3<f32>, 
    albedo: vec3<f32>, 
    metallic: f32, 
    roughness: f32, 
    lightColor: vec3<f32>
) -> vec3<f32> {
    let H = normalize(V + L);
    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let VdotH = max(dot(V, H), 0.0);

    // Cook-Torrance BRDF
    let NDF = distributionGGX(NdotH, roughness);
    let G = geometrySmith(N, V, L, roughness);
    let F = fresnelSchlick(VdotH, F0);

    // Calculate specular and diffuse components
    let numerator = NDF * G * F;
    let denominator = 4.0 * NdotV * NdotL + 0.0001;
    let specular = numerator / denominator;

    // Energy conservation
    let kS = F; // Specular reflection coefficient
    var kD = vec3<f32>(1.0) - kS; // Diffuse reflection coefficient
    kD *= 1.0 - metallic; // Metals have no diffuse lighting

    // Lambertian diffuse
    let diffuse = kD * albedo / 3.14159265;

    return (diffuse + specular) * lightColor * NdotL;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // ===== Sample Material Properties =====
    var albedo = material.albedo.rgb;
    var metallic = material.metallicRoughnessNormalOcclusion.x;
    var roughness = material.metallicRoughnessNormalOcclusion.y;
    let normalIntensity = material.metallicRoughnessNormalOcclusion.z;
    let occlusionStrength = material.metallicRoughnessNormalOcclusion.w;
    var emissive = material.emissive.rgb;
    var ao = 1.0;

    // ===== Sample Textures =====
    
    // Albedo texture
    if (material.textureFlags.x > 0.5) {
        let albedoSample = textureSample(albedoTexture, materialSampler, in.texCoords);
        albedo = albedo * albedoSample.rgb;
        // Use alpha from albedo texture if present
        // (todo: for transparency support in the future)
    }

    // Metallic-Roughness texture (glTF standard: R=unused, G=roughness, B=metallic)
    if (material.textureFlags.y > 0.5) {
        let metallicRoughnessSample = textureSample(metallicRoughnessTexture, materialSampler, in.texCoords);
        roughness = roughness * metallicRoughnessSample.g;
        metallic = metallic * metallicRoughnessSample.b;
    }

    // Emissive texture
    if (material.textureFlags.w > 0.5) {
        let emissiveSample = textureSample(emissiveTexture, materialSampler, in.texCoords);
        emissive = emissive * emissiveSample.rgb;
    }

    // Ambient Occlusion texture
    // Note: We check a bit beyond textureFlags.w since we only have 4 flags in the vec4
    // we're assuming occlusion is always sampled if the texture is bound
    let occlusionSample = textureSample(occlusionTexture, materialSampler, in.texCoords);
    ao = mix(1.0, occlusionSample.r, occlusionStrength);

    // ===== Normal Mapping =====
    let N = getNormalFromMap(in, normalIntensity);
    let V = normalize(scene.cameraPos.xyz - in.worldPosition);
    
    // ===== Calculate Base Reflectance =====
    // Dielectric materials have F0 around 0.04, metals use albedo as F0
    var F0 = vec3<f32>(0.04);
    F0 = mix(F0, albedo, metallic);

    // Clamp roughness to prevent division by zero
    roughness = clamp(roughness, 0.04, 1.0);

    // ===== Direct Lighting =====
    var Lo = vec3<f32>(0.0);
    
    for (var i: u32 = 0u; i < lightsBuffer.count; i = i + 1u) {
        let light = lightsBuffer.lights[i];
        let lightPos = light.position.xyz;
        let lightColor = light.color.rgb;
        
        // Calculate light direction and attenuation
        let L = normalize(lightPos - in.worldPosition);
        let distance = length(lightPos - in.worldPosition);
        let attenuation = 1.0 / (distance * distance);
        let radiance = lightColor * attenuation;

        // Add this light's contribution
        Lo += calculateLightContribution(L, N, V, F0, albedo, metallic, roughness, radiance);
    }

    // ===== Ambient Lighting =====
    // Simple ambient lighting (will be replaced with IBL later)
    let kS = fresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
    var kD = 1.0 - kS;
    kD *= 1.0 - metallic;
    
    let irradiance = scene.ambientColor.rgb;
    let diffuse = irradiance * albedo;
    
    // Simple ambient specular approximation
    let ambientSpecular = irradiance * 0.1 * F0;
    
    let ambient = (kD * diffuse + ambientSpecular) * ao;

    // ===== Final Color Assembly =====
    var color = ambient + Lo + emissive;

    // ===== Tone Mapping =====
    // ACES tone mapping (more filmic than Reinhard)
    color = ACESFilmicToneMapping(color);
    
    // ===== Gamma Correction =====
    color = pow(color, vec3<f32>(1.0 / 2.2));

    return vec4<f32>(color, material.albedo.a);
}

// ACES Filmic Tone Mapping
fn ACESFilmicToneMapping(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}
