// src/core/shaders/pbr.wgsl
#include "utils.wgsl"

const PI: f32 = 3.141592653589793;

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
    viewMatrix: mat4x4<f32>,
    inverseViewProjectionMatrix: mat4x4<f32>,
}

struct SceneUniforms {
    cameraPos: vec4<f32>,
    fogColor: vec4<f32>,
    fogParams: vec4<f32>,       // [density, height, heightFalloff, inscatteringIntensity]
    miscParams: vec4<f32>,      // [fogEnabled, hdrEnabled, prefilteredMipLevels, pad]
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
  albedo_factor: vec4<f32>,
  params0: vec4<f32>, // .x=metallic, .y=roughness, .z=normalIntensity, .w=occlusionStrength
  emissive: vec4<f32>, // .rgb=emissive_factor, .w=emissive_strength
  specular: vec4<f32>, // .rgb=specular_color_factor, .w=specular_factor
  texture_flags0: vec4<f32>, // .x=hasAlbedo, .y=hasMR, .z=hasNormal, .w=hasEmissive
  texture_flags1: vec4<f32>, // .x=hasOcclusion, .y=hasSpecFactor, .z=hasSpecColor, .w=usesPackedOcclusion
  uv_indices0: vec4<f32>, // .x=albedo, .y=mr, .z=normal, .w=emissive
  uv_indices1: vec4<f32>, // .x=occlusion, .y=specFactor, .z=specColor, .w=pad
  uv_scale: vec2<f32>, // Tiling factor
}

struct Cascade {
    lightViewProj: mat4x4<f32>,
    splitDepth: vec4<f32>, // Only .x is used.
};

struct ShadowUniforms {
    cascades: array<Cascade, 4>,
    lightDir: vec4<f32>,  // xyz used
    lightColor: vec4<f32>,  // rgb used
    params0: vec4<f32>, // intensity, pcfRadius, mapSize, depthBias
};

// @group(0) - Per-frame data
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightsBuffer: LightsBuffer;
@group(0) @binding(2) var<uniform> scene: SceneUniforms;
@group(0) @binding(3) var<uniform> clusterParams: ClusterParams;
@group(0) @binding(4) var<storage, read> clusterCounts: ClusterCounts;
@group(0) @binding(5) var<storage, read> clusterLightIndices: ClusterLightIndices;
@group(0) @binding(6) var irradianceMap: texture_cube<f32>;
@group(0) @binding(7) var prefilteredMap: texture_cube<f32>;
@group(0) @binding(8) var brdfLUT: texture_2d<f32>;
@group(0) @binding(9) var iblSampler: sampler;
@group(0) @binding(10) var shadowMap: texture_depth_2d_array;
@group(0) @binding(11) var shadowSampler: sampler_comparison;
@group(0) @binding(12) var<uniform> shadow: ShadowUniforms;

// @group(1) - Per-material data
@group(1) @binding(0) var albedo_texture: texture_2d<f32>;
@group(1) @binding(1) var metallic_roughness_texture: texture_2d<f32>;
@group(1) @binding(2) var normal_texture: texture_2d<f32>;
@group(1) @binding(3) var emissive_texture: texture_2d<f32>;
@group(1) @binding(4) var occlusion_texture: texture_2d<f32>;
@group(1) @binding(5) var specular_factor_texture: texture_2d<f32>;
@group(1) @binding(6) var specular_color_texture: texture_2d<f32>;
@group(1) @binding(7) var material_sampler: sampler;
@group(1) @binding(8) var<uniform> material: PBRMaterialUniforms;


fn clusterIndex(ix: u32, iy: u32, iz: u32) -> u32 {
    return iz * (clusterParams.gridX * clusterParams.gridY) + iy * clusterParams.gridX + ix;
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) worldPosition: vec3<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) worldTangent: vec3<f32>,
    @location(3) worldBitangent: vec3<f32>,
    @location(4) texCoords0: vec2<f32>,
    @location(5) texCoords1: vec2<f32>,
    @location(6) @interpolate(flat) instanceFlags: u32,
}

@vertex
fn vs_main(
    @location(0) inPos: vec3<f32>,
    @location(1) inNormal: vec3<f32>,
    @location(2) inTexCoords0: vec2<f32>,
    @location(3) inTangent: vec4<f32>,
    @location(9) inTexCoords1: vec2<f32>,
    @location(4) model_mat_col_0: vec4<f32>,
    @location(5) model_mat_col_1: vec4<f32>,
    @location(6) model_mat_col_2: vec4<f32>,
    @location(7) model_mat_col_3: vec4<f32>,
    @location(8) instanceFlags: u32
) -> VertexOutput {
    var out: VertexOutput;

    let modelMatrix = mat4x4<f32>(
        model_mat_col_0, model_mat_col_1, model_mat_col_2, model_mat_col_3
    );
    var modelMatrix3x3 = mat3x3<f32>(
        modelMatrix[0].xyz,
        modelMatrix[1].xyz,
        modelMatrix[2].xyz,
    );

    let worldPos4 = modelMatrix * vec4<f32>(inPos, 1.0);
    out.worldPosition = worldPos4.xyz;
    out.clip_position = camera.viewProjectionMatrix * worldPos4;
    out.texCoords0 = inTexCoords0;
    out.texCoords1 = inTexCoords1;

    // calculate normal matrix and transform normals/tangents
    let isUniformScale = (instanceFlags & 1u) != 0u;
    if (!isUniformScale) {
        // For non-uniform scale, use inverse-transpose
        modelMatrix3x3 = transpose(mat3_inverse(modelMatrix3x3));
    }
    
    out.worldNormal = normalize(modelMatrix3x3 * inNormal);
    out.worldTangent = normalize(modelMatrix3x3 * inTangent.xyz);
    out.worldBitangent = normalize(cross(out.worldNormal, out.worldTangent) * inTangent.w);
    out.instanceFlags = instanceFlags;

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

struct FragmentInput {
    @location(0) worldPosition: vec3<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) worldTangent: vec3<f32>,
    @location(3) worldBitangent: vec3<f32>,
    @location(4) texCoords0: vec2<f32>,
    @location(5) texCoords1: vec2<f32>,
    @location(6) @interpolate(flat) instanceFlags: u32,
}

fn pickUV(uvIndex: f32, uv0: vec2<f32>, uv1: vec2<f32>) -> vec2<f32> {
    return mix(uv0, uv1, step(0.5, uvIndex));
}

// Unpack normal from normal map
fn getNormalFromMap(fi: FragmentInput, normalIntensity: f32) -> vec3<f32> {
    if (material.texture_flags0.z < 0.5) {
        return normalize(fi.worldNormal);
    }

    let normalUV = pickUV(material.uv_indices0.z, fi.texCoords0, fi.texCoords1) * material.uv_scale;
    let tangentNormal = textureSample(normal_texture, material_sampler, normalUV).xyz * 2.0 - 1.0;

    var adjustedNormal = tangentNormal;
    adjustedNormal.x *= normalIntensity;
    adjustedNormal.y *= normalIntensity;
    adjustedNormal = normalize(adjustedNormal);

    let N = normalize(fi.worldNormal);
    let T = normalize(fi.worldTangent);
    let B = normalize(fi.worldBitangent);

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
    specularFactor: f32,
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
    var specular = numerator / denominator;
    
    // Apply specular factor for dielectric materials only
    specular = specular * mix(specularFactor, 1.0, metallic);

    // Energy conservation
    let kS = F; // Specular reflection coefficient
    var kD = vec3<f32>(1.0) - kS; // Diffuse reflection coefficient
    kD *= 1.0 - metallic; // Metals have no diffuse lighting

    // Lambertian diffuse
    let diffuse = kD * albedo / 3.14159265;

    return (diffuse + specular) * lightColor * NdotL;
}

fn getShadowCascade(viewZ: f32) -> i32 {
    if (viewZ > shadow.cascades[2].splitDepth.x) {
        return 3;
    } else if (viewZ > shadow.cascades[1].splitDepth.x) {
        return 2;
    } else if (viewZ > shadow.cascades[0].splitDepth.x) {
        return 1;
    }
    return 0;
}

fn projectToShadowSpace(worldPos: vec3<f32>, cascadeIndex: i32) -> vec3<f32> {
    let wp = vec4<f32>(worldPos, 1.0);
    let sp = shadow.cascades[cascadeIndex].lightViewProj * wp;
    let ndc = sp.xyz / sp.w;
    let uv = ndc.xy * 0.5 + vec2<f32>(0.5);
    let depth = ndc.z;
    return vec3<f32>(uv, depth);
}

fn sampleShadowPCF(uv: vec2<f32>, depth: f32, pcfRadius: f32, mapSize: f32, cascadeIndex: i32) -> f32 {
    let texel = vec2<f32>(1.0 / mapSize);
    var sum = 0.0;
    let taps = 9.0;
    for (var j: i32 = -1; j <= 1; j = j + 1) {
        for (var i: i32 = -1; i <= 1; i = i + 1) {
            let offs = vec2<f32>(f32(i), f32(j)) * texel * pcfRadius;
            sum += textureSampleCompare(shadowMap, shadowSampler, uv + offs, cascadeIndex, depth);
        }
    }
    return sum / taps;
}

@fragment
fn fs_main(fi: FragmentInput, @builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
    // ===== Sample Material Properties =====
    var albedo = material.albedo_factor.rgb;
    var metallic = material.params0.x;
    var roughness = material.params0.y;
    let normalIntensity = material.params0.z;
    let occlusionStrength = material.params0.w;
    var emissive = material.emissive.rgb;
    var specularColor = material.specular.rgb;
    var specularFactor = material.specular.w;
    var ao = 1.0;

    // Textures
    if (material.texture_flags0.x > 0.5) { // hasAlbedoMap
        let albedoUV = pickUV(material.uv_indices0.x, fi.texCoords0, fi.texCoords1) * material.uv_scale;
        let albedoSample = textureSample(albedo_texture, material_sampler, albedoUV);
        albedo = albedo * albedoSample.rgb;
    }
    
    let mrUV = pickUV(material.uv_indices0.y, fi.texCoords0, fi.texCoords1) * material.uv_scale;
    let mrSample = textureSample(metallic_roughness_texture, material_sampler, mrUV);
    if (material.texture_flags0.y > 0.5) { // hasMetallicRoughnessMap
        roughness = roughness * mrSample.g;
        metallic = metallic * mrSample.b;
    }
    
    if (material.texture_flags0.w > 0.5) { // hasEmissiveMap
        let emissiveUV = pickUV(material.uv_indices0.w, fi.texCoords0, fi.texCoords1) * material.uv_scale;
        let emissiveSample = textureSample(emissive_texture, material_sampler, emissiveUV);
        emissive = emissive * emissiveSample.rgb;
    }

    // Occlusion with supports for packed textures (ARM/ORM)
    if (material.texture_flags1.w > 0.5) { // usesPackedOcclusion
        ao = mix(1.0, mrSample.r, occlusionStrength);
    } else if (material.texture_flags1.x > 0.5) { // hasOcclusionMap
        let occlusionUV = pickUV(material.uv_indices1.x, fi.texCoords0, fi.texCoords1) * material.uv_scale;
        let occlusionSample = textureSample(occlusion_texture, material_sampler, occlusionUV);
        ao = mix(1.0, occlusionSample.r, occlusionStrength);
    }
    
    // KHR_materials_specular sampling
    if (material.texture_flags1.y > 0.5) { // hasSpecularFactorMap
        let uv = pickUV(material.uv_indices1.y, fi.texCoords0, fi.texCoords1) * material.uv_scale;
        specularFactor = specularFactor * textureSample(specular_factor_texture, material_sampler, uv).a;
    }
    if (material.texture_flags1.z > 0.5) { // hasSpecularColorMap
        let uv = pickUV(material.uv_indices1.z, fi.texCoords0, fi.texCoords1) * material.uv_scale;
        specularColor = specularColor * textureSample(specular_color_texture, material_sampler, uv).rgb;
    }

    // Normals and view vector
    let N = getNormalFromMap(fi, normalIntensity);
    let V = normalize(scene.cameraPos.xyz - fi.worldPosition);
    let R = reflect(-V, N);

    // Base reflectance
    // F0 for dielectrics is tinted by specularColor
    var F0 = vec3<f32>(0.04) * specularColor;
    F0 = mix(F0, albedo, metallic);
    roughness = clamp(roughness, 0.04, 1.0);

    // ===== Direct Lighting via clustering =====
    var Lo = vec3<f32>(0.0);

    // View-like depth along camera forward
    let toPoint = fi.worldPosition - clusterParams.cameraPos.xyz;
    let viewZraw = dot(toPoint, clusterParams.cameraForward.xyz);
    let viewZ = max(viewZraw, clusterParams.near + 1e-4);

    if (viewZ >= clusterParams.near && viewZ <= clusterParams.far) {
        let zNorm = (viewZ - clusterParams.near) * clusterParams.invZRange;
        let izF = clamp(floor(zNorm * f32(clusterParams.gridZ)), 0.0, f32(clusterParams.gridZ) - 1.0);
        let iz = u32(izF);

        let tileW = clusterParams.viewportSize.x / f32(clusterParams.gridX);
        let tileH = clusterParams.viewportSize.y / f32(clusterParams.gridY);

        let ixF = clamp(floor(fragPos.x / tileW), 0.0, f32(clusterParams.gridX) - 1.0);
        let iyF = clamp(floor(fragPos.y / tileH), 0.0, f32(clusterParams.gridY) - 1.0);
        let ix = u32(ixF);
        let iy = u32(iyF);

        let cidx = clusterIndex(ix, iy, iz);
        let count = clusterCounts.counts[cidx];
        let maxCount = clusterParams.maxPerCluster;
        let countClamped = min(count, maxCount);

        for (var i: u32 = 0u; i < countClamped; i = i + 1u) {
            let idx = clusterLightIndices.indices[cidx * maxCount + i];

            let light = lightsBuffer.lights[idx];
            let lightPos = light.position.xyz;
            let lightColor = light.color.rgb;
            let range = max(light.params0.x, 0.0001);
            let intensity = light.params0.y;

            let Lvec = lightPos - fi.worldPosition;
            let dist = length(Lvec);
            if (dist > range) { continue; }
            let L = Lvec / max(dist, 0.0001);

            let attenuation = 1.0 / max(dist * dist, 0.0001);
            let r = clamp(dist / range, 0.0, 1.0);
            let rangeFalloff = 1.0 - (r * r * r * r);
            let radiance = lightColor * attenuation * intensity * rangeFalloff;

            Lo += calculateLightContribution(L, N, V, F0, albedo, metallic, roughness, specularFactor, radiance);
        }
    }

    // ===== Directional Sun Light with Shadow =====
    let intensity = shadow.params0.x;
    let pcfRadius = shadow.params0.y;
    let mapSize = shadow.params0.z;
    let depthBias = shadow.params0.w;
    let receiveShadowsFloat = select(0.0, 1.0, (fi.instanceFlags & 2u) != 0u);
    let Ls = normalize(-shadow.lightDir.xyz);
    let sunColor = shadow.lightColor.rgb * intensity;

    let VIEW_Z_SHADOW = dot(fi.worldPosition - scene.cameraPos.xyz, camera.viewMatrix[2].xyz);
    let cascadeIndex = getShadowCascade(VIEW_Z_SHADOW);
    
    let sh = projectToShadowSpace(fi.worldPosition, cascadeIndex);
    let cmpDepth = sh.z - depthBias;
    let shadowSample = sampleShadowPCF(sh.xy, cmpDepth, pcfRadius, mapSize, cascadeIndex);
    let shadowFactor = mix(1.0, shadowSample, receiveShadowsFloat);
    
    let sunTerm = calculateLightContribution(Ls, N, V, F0, albedo, metallic, roughness, specularFactor, sunColor);
    Lo += sunTerm * shadowFactor;


    // ===== Indirect Lighting (IBL) =====
    let F = fresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
    
    let kS = F;
    var kD = vec3<f32>(1.0) - kS;
    kD *= (1.0 - metallic);
    
    let irradiance = textureSample(irradianceMap, iblSampler, N).rgb;
    let diffuseIBL = irradiance * albedo;
    
    let maxMipLevel = scene.miscParams.z - 1.0;
    let prefilteredColor = textureSampleLevel(prefilteredMap, iblSampler, R, roughness * maxMipLevel).rgb;
    let brdf = textureSample(brdfLUT, iblSampler, vec2<f32>(max(dot(N, V), 0.0), roughness)).rg;
    var specularIBL = prefilteredColor * (F * brdf.x + brdf.y);
    
    // Apply specular factor to IBL for dielectrics only
    specularIBL = specularIBL * mix(specularFactor, 1.0, metallic);
    
    let ambient = (kD * diffuseIBL + specularIBL) * ao;

    var color = ambient + Lo;

    // ===== Volumetric Fog =====
    if (scene.miscParams.x > 0.5) { // Check fogEnabled flag
        let view_dir = normalize(fi.worldPosition - scene.cameraPos.xyz);
        let dist_to_camera = length(fi.worldPosition - scene.cameraPos.xyz);

        let fog_density = scene.fogParams.x;
        let fog_height = scene.fogParams.y;
        let fog_falloff = scene.fogParams.z;
        let sun_inscatter_intensity = scene.fogParams.w;

        let y_cam = scene.cameraPos.y;
        let y_pixel = fi.worldPosition.y;

        var optical_depth = 0.0;
        if (abs(view_dir.y) > 0.0001) {
            let term1 = exp(-fog_falloff * (y_cam - fog_height));
            let term2 = exp(-fog_falloff * (y_pixel - fog_height));
            let integral = (dist_to_camera / view_dir.y) * (term1 - term2);
            optical_depth = max(0.0, fog_density * integral);
        } else {
            let height_term = exp(-fog_falloff * (y_cam - fog_height));
            optical_depth = max(0.0, fog_density * height_term * dist_to_camera);
        }
        
        let extinction = exp(-optical_depth);

        let sun_dir = -Ls;
        let cos_angle = dot(view_dir, sun_dir);
        let g = 0.76;
        let phase = (1.0 - g*g) / (4.0 * PI * pow(1.0 + g*g - 2.0*g*cos_angle, 1.5));

        let sun_intensity = shadow.params0.x;
        let sun_inscattering = shadow.lightColor.rgb * sun_intensity * sun_inscatter_intensity * phase * shadowFactor;
        let ambient_inscattering = scene.fogColor.rgb;
        let total_inscattering = sun_inscattering + ambient_inscattering;

        color = mix(total_inscattering, color, extinction);
    }

    // Add emissive color after fog so it cuts through, scaled by emissiveStrength
    color += emissive * material.emissive.w;

    // Conditionally apply tone mapping based on scene.miscParams.y
    var final_color = color;
    if (scene.miscParams.y > 0.5) {
        final_color = ACESFilmicToneMapping(color);
    }

    return vec4<f32>(final_color, material.albedo_factor.a);
}
