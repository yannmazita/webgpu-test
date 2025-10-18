// src/core/shaders/particle.wgsl
#include "utils.wgsl"

// Frame-level uniforms
struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    inverseViewProjectionMatrix: mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> camera: CameraUniforms;

// Particle data structure in the buffer
struct Particle {
    position: vec3<f32>,
    lifetime: f32,
    velocity: vec3<f32>,
    age: f32,
    start_size: f32,
    end_size: f32,
    start_color: vec4<f32>,
    end_color: vec4<f32>,
};

// The storage buffer containing all particles
struct ParticlesBuffer {
    particles: array<Particle>,
};

// ------ Render Pipeline Shaders ------

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
};

// We only need the particle buffer for rendering
@group(1) @binding(0) var<storage, read> render_particles: ParticlesBuffer;
@group(1) @binding(1) var particle_texture: texture_2d<f32>;
@group(1) @binding(2) var particle_sampler: sampler;

// Quad vertices for building the billboard
const QUAD_VERTS = array<vec2<f32>, 4>(
    vec2<f32>(-0.5, 0.5),
    vec2<f32>(-0.5, -0.5),
    vec2<f32>(0.5, 0.5),
    vec2<f32>(0.5, -0.5)
);

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOutput {
    var out: VertexOutput;

    let p = render_particles.particles[instance_index];

    // Don't draw dead particles
    if (p.age >= p.lifetime || p.lifetime <= 0.0) {
        out.clip_position = vec4<f32>(2.0, 2.0, 2.0, 1.0); // Move off-screen
        return out;
    }

    let t = clamp(p.age / p.lifetime, 0.0, 1.0);
    let size = mix(p.start_size, p.end_size, t);
    out.color = mix(p.start_color, p.end_color, t);

    let quad_pos = QUAD_VERTS[vertex_index % 4u];
    out.uv = quad_pos + 0.5;

    // Billboard the quad to face the camera
    let camera_right = vec3<f32>(camera.viewMatrix[0][0], camera.viewMatrix[1][0], camera.viewMatrix[2][0]);
    let camera_up = vec3<f32>(camera.viewMatrix[0][1], camera.viewMatrix[1][1], camera.viewMatrix[2][1]);
    
    let world_pos = p.position + (camera_right * quad_pos.x * size) + (camera_up * quad_pos.y * size);

    out.clip_position = camera.viewProjectionMatrix * vec4<f32>(world_pos, 1.0);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let tex_color = textureSample(particle_texture, particle_sampler, in.uv);
    return in.color * tex_color;
}
