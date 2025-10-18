// src/core/shaders/particle_compute.wgsl
#include "utils.wgsl"

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
    padding: u32, // Align to 16 bytes
};

@group(0) @binding(0) var<uniform> sim_params: SimParams;
@group(0) @binding(1) var<storage, read> particles_in: ParticlesBuffer;
@group(0) @binding(2) var<storage, read_write> particles_out: ParticlesBuffer;

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
