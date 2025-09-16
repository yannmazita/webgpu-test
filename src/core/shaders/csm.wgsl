// src/core/shaders/csm.wgsl
#ifndef CSM_WGSL
#define CSM_WGSL

fn get_cascade_index(view_depth: f32) -> i32 {
    // view_depth is negative, cascade_splits are negative.
    // We need to find the first cascade split that is *less* than the view_depth.
    if (view_depth > shadow.cascadeSplits[0]) {
        return 0;
    }
    if (view_depth > shadow.cascadeSplits[1]) {
        return 1;
    }
    if (view_depth > shadow.cascadeSplits[2]) {
        return 2;
    }
    return 3;
}

fn calculate_shadow_factor(world_pos: vec3<f32>, view_depth: f32) -> f32 {
    let cascade_index = get_cascade_index(view_depth);
    let light_space_pos = shadow.lightViewProj[cascade_index] * vec4<f32>(world_pos, 1.0);

    // perspective divide
    let light_proj_pos = light_space_pos.xyz / light_space_pos.w;
    
    // transform from [-1, 1] to [0, 1]
    let light_uv = light_proj_pos * vec3<f32>(0.5, -0.5, 1.0) + vec3<f32>(0.5, 0.5, 0.0);

    if (light_uv.x < 0.0 || light_uv.x > 1.0 || light_uv.y < 0.0 || light_uv.y > 1.0 || light_uv.z > 1.0) {
        return 1.0; // Not in shadow
    }

    let shadow_factor = textureSampleCompare(
        shadowMap,
        shadowSampler,
        light_uv.xy,
        u32(cascade_index),
        light_uv.z - 0.002 // bias
    );

    return shadow_factor;
}

#endif
