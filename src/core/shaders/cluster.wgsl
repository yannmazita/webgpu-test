// src/core/shaders/cluster.wgsl

struct Light {
  position: vec4<f32>,
  color: vec4<f32>,
  params0: vec4<f32>, // [range, intensity, type, pad0]
};

struct LightsBuffer {
  count: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  lights: array<Light>,
};

struct ClusterParams {
  gridZ: u32,
  maxPerCluster: u32,
  pad0: u32,
  pad1: u32,
  near: f32,
  far: f32,
  invZRange: f32,
  pad2: f32,
  cameraForward: vec4<f32>, // xyz used
  cameraPos: vec4<f32>,     // xyz used
};

// Storage buffers for clusters
struct ClusterCounts {
  counts: array<atomic<u32>>,
};

struct ClusterLightIndices {
  indices: array<u32>,
};

// Bindings for compute
@group(0) @binding(0) var<uniform> clusterParams: ClusterParams;
@group(0) @binding(1) var<storage, read> lightsBuffer: LightsBuffer;
@group(0) @binding(2) var<storage, read_write> clusterCountsRW: ClusterCounts;
@group(0) @binding(3) var<storage, read_write> clusterLightIndicesRW: ClusterLightIndices;

// Workgroup size for clear
@compute @workgroup_size(64)
fn cs_clear_counts(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx < clusterParams.gridZ) {
    // Zero the counter for this Z-slice
    atomicStore(&clusterCountsRW.counts[idx], 0u);
  }
}

// Assign each light to overlapping z-slices
@compute @workgroup_size(64)
fn cs_assign_lights(@builtin(global_invocation_id) gid: vec3<u32>) {
  let li = gid.x;
  if (li >= lightsBuffer.count) {
    return;
  }

  let lp = lightsBuffer.lights[li].position.xyz;
  let range = max(lightsBuffer.lights[li].params0.x, 0.0001);

  // Project center to camera-forward axis (view-like depth in world space)
  let toLight = lp - clusterParams.cameraPos.xyz;
  let centerZ = dot(toLight, clusterParams.cameraForward.xyz);

  // Depth interval influenced by the light
  var zMin = centerZ - range;
  var zMax = centerZ + range;

  // Clip to camera near/far
  zMin = max(zMin, clusterParams.near);
  zMax = min(zMax, clusterParams.far);
  if (zMax <= zMin) {
    return;
  }

  // Linear Z slicing
  let z0 = (zMin - clusterParams.near) * clusterParams.invZRange;
  let z1 = (zMax - clusterParams.near) * clusterParams.invZRange;

  let gridZf = f32(clusterParams.gridZ);
  var sliceMin = i32(floor(z0 * gridZf));
  var sliceMax = i32(floor(z1 * gridZf));

  sliceMin = clamp(sliceMin, 0, i32(clusterParams.gridZ) - 1);
  sliceMax = clamp(sliceMax, 0, i32(clusterParams.gridZ) - 1);

  // For each overlapped Z-slice, append light index
  for (var s = sliceMin; s <= sliceMax; s = s + 1) {
    let us = u32(s);
    let writeIdx = atomicAdd(&clusterCountsRW.counts[us], 1u);
    if (writeIdx < clusterParams.maxPerCluster) {
      let base = us * clusterParams.maxPerCluster + writeIdx;
      clusterLightIndicesRW.indices[base] = li;
    }
    // else: overflow; ignore excess lights for this slice
  }
}
