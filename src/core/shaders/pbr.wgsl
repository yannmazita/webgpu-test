#include "utils.wgsl"

struct ClusterParams {
    gridX: u32,
    gridY: u32,
    gridZ: u32,
    maxPerCluster: u32,

    viewportSize: vec2<f32>,
    invViewportSize: vec2<f32>,

    near: f32,
    far: f32,
    invZRange: f32,
    tanHalfFovY: f32,

    aspect: f32,
    pad0: f32,
    pad1: f32,
    pad2: f32,

    cameraRight: vec4<f32>,
    cameraUp: vec4<f32>,
    cameraForward: vec4<f32>,
    cameraPos: vec4<f32>,
}

struct ClusterCounts {
    counts: array<u32>,
}

struct ClusterLightIndices {
    indices: array<u32>,
}

// Frame-level uniforms
struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
}

struct SceneUniforms {
    cameraPos: vec4<f32>,
    ambientColor: vec4<f32>,
    fogColor: vec4<f32>,
    fogParams0: vec4<f32>, // [distanceDensity, height, heightFalloff, enableFlags]
    fogParams1: vec4<f32>, // reserved/extensible
}

struct Light {
    position: vec4<f32>,
    color: vec4<f32>,
    params0: vec4<f32>, // [range, intensity, type, pad0]
}

struct LightsBuffer {
    // explicit padding
    count: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
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
@group(0) @binding(3) var<uniform> clusterParams: ClusterParams;
@group(0) @binding(4) var<storage, read> clusterCounts: ClusterCounts;
@group(0) @binding(5) var<storage, read> clusterLightIndices: ClusterLightIndices;

// @group(1) - Per-material data
@group(1) @binding(0) var albedoTexture: texture_2d<f32>;
@group(1) @binding(1) var metallicRoughnessTexture: texture_2d<f32>;
@group(1) @binding(2) var normalTexture: texture_2d<f32>;
@group(1) @binding(3) var emissiveTexture: texture_2d<f32>;
@group(1) @binding(4) var occlusionTexture: texture_2d<f32>;
@group(1) @binding(5) var materialSampler: sampler;
@group(1) @binding(6) var<uniform> material: PBRMaterialUniforms;

fn clusterIndex(ix: u32, iy: u32, iz: u32) -> u32 {
    return iz * (clusterParams.gridX * clusterParams.gridY) + iy * clusterParams.gridX + ix;
}

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
    // Albedo
    if (material.textureFlags.x > 0.5) {
        let albedoSample = textureSample(albedoTexture, materialSampler, in.texCoords);
        albedo = albedo * albedoSample.rgb;
    }

    // Metallic-Roughness (G=roughness, B=metallic per glTF)
    if (material.textureFlags.y > 0.5) {
        let mrSample = textureSample(metallicRoughnessTexture, materialSampler, in.texCoords);
        roughness = roughness * mrSample.g;
        metallic = metallic * mrSample.b;
    }

    // Emissive
    if (material.textureFlags.w > 0.5) {
        let emissiveSample = textureSample(emissiveTexture, materialSampler, in.texCoords);
        emissive = emissive * emissiveSample.rgb;
    }

    // Ambient Occlusion (sample if bound; strength controls blend)
    let occlusionSample = textureSample(occlusionTexture, materialSampler, in.texCoords);
    ao = mix(1.0, occlusionSample.r, occlusionStrength);

    // ===== Normal Mapping =====
    let N = getNormalFromMap(in, normalIntensity);
    let V = normalize(scene.cameraPos.xyz - in.worldPosition);

    // ===== Base Reflectance =====
    var F0 = vec3<f32>(0.04);
    F0 = mix(F0, albedo, metallic);
    roughness = clamp(roughness, 0.04, 1.0);


    // ===== Direct Lighting via 3D clustering (X*Y*Z) =====
    var Lo = vec3<f32>(0.0);

    // View-like depth along camera forward
    let toPoint = in.worldPosition - clusterParams.cameraPos.xyz;
    let viewZ = dot(toPoint, clusterParams.cameraForward.xyz);

    if (viewZ >= clusterParams.near && viewZ <= clusterParams.far) {
        // Z slice
        let zNorm = (viewZ - clusterParams.near) * clusterParams.invZRange;
        let iz = u32(clamp(floor(zNorm * f32(clusterParams.gridZ)), 0.0, f32(clusterParams.gridZ - 1u)));

        // XY tile from pixel position (@builtin(position) is in.screen space pixels)
        let tileW = clusterParams.viewportSize.x / f32(clusterParams.gridX);
        let tileH = clusterParams.viewportSize.y / f32(clusterParams.gridY);

        let px = in.clip_position.x;
        let py = in.clip_position.y;

        let ix = u32(clamp(floor(px / tileW), 0.0, f32(clusterParams.gridX - 1u)));
        let iy = u32(clamp(floor(py / tileH), 0.0, f32(clusterParams.gridY - 1u)));

        let cidx = clusterIndex(ix, iy, iz);
        let count = clusterCounts.counts[cidx];
        let maxCount = clusterParams.maxPerCluster;

        for (var i: u32 = 0u; i < count; i = i + 1u) {
            if (i >= maxCount) { break; }
            let idx = clusterLightIndices.indices[cidx * maxCount + i];

            let light = lightsBuffer.lights[idx];
            let lightPos = light.position.xyz;
            let lightColor = light.color.rgb;
            let range = max(light.params0.x, 0.0001);
            let intensity = light.params0.y;

            let Lvec = lightPos - in.worldPosition;
            let dist = length(Lvec);
            if (dist > range) {
                continue;
            }
            let L = Lvec / max(dist, 0.0001);
            let attenuation = 1.0 / max(dist * dist, 0.0001);
            let r = clamp(dist / range, 0.0, 1.0);
            let rangeFalloff = 1.0 - (r * r * r * r);
            let radiance = lightColor * attenuation * intensity * rangeFalloff;

            Lo += calculateLightContribution(L, N, V, F0, albedo, metallic, roughness, radiance);
        }
    }

    // ===== Ambient Lighting =====
    let kS = fresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
    var kD = 1.0 - kS;
    kD *= 1.0 - metallic;

    let irradiance = scene.ambientColor.rgb;
    let diffuse = irradiance * albedo;
    let ambientSpecular = irradiance * 0.1 * F0;

    let ambient = (kD * diffuse + ambientSpecular) * ao;

    // ===== Combine =====
    var color = ambient + Lo + emissive;

    // ===== Fog (distance + height, linear space) =====
    // fogParams0 = [distanceDensity, height, heightFalloff, enableFlags]
    let distanceDensity = scene.fogParams0.x;
    let fogHeight = scene.fogParams0.y;
    let heightFalloff = scene.fogParams0.z;
    let enableFlags = scene.fogParams0.w;

    if (enableFlags > 0.0) {
        let dist = length(scene.cameraPos.xyz - in.worldPosition);
        let fd = exp(-distanceDensity * dist);

        let dh = max(in.worldPosition.y - fogHeight, 0.0);
        let fh = exp(-heightFalloff * dh);

        let f = clamp(fd * fh, 0.0, 1.0);
        color = mix(scene.fogColor.rgb, color, f);
    }

    // ===== Tone Mapping and Gamma =====
    color = ACESFilmicToneMapping(color);
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
