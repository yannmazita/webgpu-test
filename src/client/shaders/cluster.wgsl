// src/client/shaders/cluster.wgsl

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
  gridX: u32,
  gridY: u32,
  gridZ: u32,
  maxPerCluster: u32,

  viewportSize: vec2<f32>,     // width, height in pixels
  invViewportSize: vec2<f32>,  // 1/width, 1/height

  near: f32,
  far: f32,
  invZRange: f32,
  tanHalfFovY: f32,

  aspect: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,

  cameraRight: vec4<f32>,   // xyz used
  cameraUp: vec4<f32>,      // xyz used
  cameraForward: vec4<f32>, // xyz used
  cameraPos: vec4<f32>,     // xyz used
};

struct ClusterCounts {
  counts: array<atomic<u32>>,
};

struct ClusterLightIndices {
  indices: array<u32>,
};

@group(0) @binding(0) var<uniform> clusterParams: ClusterParams;
@group(0) @binding(1) var<storage, read> lightsBuffer: LightsBuffer;
@group(0) @binding(2) var<storage, read_write> clusterCountsRW: ClusterCounts;
@group(0) @binding(3) var<storage, read_write> clusterLightIndicesRW: ClusterLightIndices;

fn numClusters() -> u32 {
  return clusterParams.gridX * clusterParams.gridY * clusterParams.gridZ;
}

@compute @workgroup_size(64)
fn cs_clear_counts(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx < numClusters()) {
    atomicStore(&clusterCountsRW.counts[idx], 0u);
  }
}

@compute @workgroup_size(64)
fn cs_assign_lights(@builtin(global_invocation_id) gid: vec3<u32>) {
  let li = gid.x;
  if (li >= lightsBuffer.count) {
    return;
  }

  let lp = lightsBuffer.lights[li].position.xyz;
  let range = max(lightsBuffer.lights[li].params0.x, 0.0001);

  // View-space components using camera basis
  let toLight = lp - clusterParams.cameraPos.xyz;
  let vx = dot(toLight, clusterParams.cameraRight.xyz);
  let vy = dot(toLight, clusterParams.cameraUp.xyz);
  let vz = dot(toLight, clusterParams.cameraForward.xyz);

  // Z overlap range
  var zMin = vz - range;
  var zMax = vz + range;
  zMin = max(zMin, clusterParams.near);
  zMax = min(zMax, clusterParams.far);
  if (zMax <= zMin) { return; }

  // Normalized Z [0,1)
  let z0 = (zMin - clusterParams.near) * clusterParams.invZRange;
  let z1 = (zMax - clusterParams.near) * clusterParams.invZRange;

  let gZ = f32(clusterParams.gridZ);
  var sliceMinZ = i32(floor(clamp(z0, 0.0, 0.99999) * gZ));
  var sliceMaxZ = i32(floor(clamp(z1, 0.0, 0.99999) * gZ));

  sliceMinZ = clamp(sliceMinZ, 0, i32(clusterParams.gridZ) - 1);
  sliceMaxZ = clamp(sliceMaxZ, 0, i32(clusterParams.gridZ) - 1);

  // Project sphere to screen to find XY bounds (pixels)
  // Perspective relationships:
  // tanHalfFovX = tanHalfFovY * aspect
  let tanHalfFovX = clusterParams.tanHalfFovY * clusterParams.aspect;
  let zSafe = max(vz, 1e-4);

  let xNdc = vx / (zSafe * tanHalfFovX);
  let yNdc = vy / (zSafe * clusterParams.tanHalfFovY);

  // Map NDC [-1,1] to pixel coords (top-left origin)
  let px = (xNdc * 0.5 + 0.5) * clusterParams.viewportSize.x;
  let py = (-yNdc * 0.5 + 0.5) * clusterParams.viewportSize.y;

  let rNdcX = range / (zSafe * tanHalfFovX);
  let rNdcY = range / (zSafe * clusterParams.tanHalfFovY);
  let rPxX = rNdcX * 0.5 * clusterParams.viewportSize.x;
  let rPxY = rNdcY * 0.5 * clusterParams.viewportSize.y;

  // Tile sizes
  let tileW = clusterParams.viewportSize.x / f32(clusterParams.gridX);
  let tileH = clusterParams.viewportSize.y / f32(clusterParams.gridY);

  var tileMinX = i32(floor((px - rPxX) / tileW));
  var tileMaxX = i32(floor((px + rPxX) / tileW));
  var tileMinY = i32(floor((py - rPxY) / tileH));
  var tileMaxY = i32(floor((py + rPxY) / tileH));

  tileMinX = clamp(tileMinX, 0, i32(clusterParams.gridX) - 1);
  tileMaxX = clamp(tileMaxX, 0, i32(clusterParams.gridX) - 1);
  tileMinY = clamp(tileMinY, 0, i32(clusterParams.gridY) - 1);
  tileMaxY = clamp(tileMaxY, 0, i32(clusterParams.gridY) - 1);

  // Append light index to all overlapped clusters
  for (var sz = sliceMinZ; sz <= sliceMaxZ; sz = sz + 1) {
    for (var ty = tileMinY; ty <= tileMaxY; ty = ty + 1) {
      for (var tx = tileMinX; tx <= tileMaxX; tx = tx + 1) {
        let clusterIdx = u32(sz) * (clusterParams.gridX * clusterParams.gridY)
                       + u32(ty) * clusterParams.gridX
                       + u32(tx);

        let writeIdx = atomicAdd(&clusterCountsRW.counts[clusterIdx], 1u);
        if (writeIdx < clusterParams.maxPerCluster) {
          let base = clusterIdx * clusterParams.maxPerCluster + writeIdx;
          clusterLightIndicesRW.indices[base] = li;
        }
        // else overflow; ignore extra lights in this cluster
      }
    }
  }
}
