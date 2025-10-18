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

// Simulation parameters
struct SimParams {
    delta_time: f32,
    gravity: f32,
    particle_count: u32,
};
@group(1) @binding(0) var<uniform> sim_params: SimParams;
@group(1) @binding(1) var<storage, read> particles_in: ParticlesBuffer;
@group(1) @binding(2) var<storage, read_write> particles_out: ParticlesBuffer;

// ------ Compute Shader: Particle Simulation ------
@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if (index >= sim_params.particle_count) {
        return;
    }

    var p_in = particles_in.particles[index];

    // If particle is dead, do nothing. It will be overwritten by the emitter.
    if (p_in.age >= p_in.lifetime) {
        particles_out.particles[index] = p_in;
        return;
    }

    var p_out: Particle;
    p_out.age = p_in.age + sim_params.delta_time;

    // If the particle just died, keep it in a dead state.
    if (p_out.age >= p_in.lifetime) {
        p_out.lifetime = 0.0; // Mark as dead
        p_out.age = 1.0; // Ensure age >= lifetime
        p_out.position = vec3<f32>(0.0);
        p_out.velocity = vec3<f32>(0.0);
    } else {
        // Update velocity with gravity
        p_out.velocity = p_in.velocity;
        p_out.velocity.y = p_out.velocity.y + sim_params.gravity * sim_params.delta_time;

        // Update position with velocity
        p_out.position = p_in.position + p_out.velocity * sim_params.delta_time;

        // Copy other properties
        p_out.lifetime = p_in.lifetime;
        p_out.start_size = p_in.start_size;
        p_out.end_size = p_in.end_size;
        p_out.start_color = p_in.start_color;
        p_out.end_color = p_in.end_color;
    }
    
    particles_out.particles[index] = p_out;
}


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
