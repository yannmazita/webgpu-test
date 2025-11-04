// src/core/shaders/ui.ts

struct ScreenUniforms {
  size: vec2f,
  _padding: vec2f,
}

@group(0) @binding(0) var<uniform> screen: ScreenUniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VertexInput {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
}

struct InstanceInput {
  @location(2) rect: vec4f,      // x, y, w, h
  @location(3) color: vec4f,
  @location(4) uvRect: vec4f,
  @location(5) params: vec4f,    // borderRadius, rotation, borderWidth, textureIndex
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) params: vec4f,
}

@vertex
fn vs_main(vertex: VertexInput, instance: InstanceInput) -> VertexOutput {
  var out: VertexOutput;
  
  // Transform quad to screen space rect
  let pos = vertex.position * vec2f(instance.rect.z, instance.rect.w) 
            + vec2f(instance.rect.x + instance.rect.z * 0.5, instance.rect.y + instance.rect.w * 0.5);
  
  // Convert to NDC (0,0 is top-left, Y-down)
  let ndc = vec2f(pos.x / screen.size.x * 2.0 - 1.0, 1.0 - pos.y / screen.size.y * 2.0);
  
  out.position = vec4f(ndc, 0.0, 1.0);
  out.uv = mix(instance.uvRect.xy, instance.uvRect.zw, vertex.uv);
  out.color = instance.color;
  out.params = instance.params;
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let texColor = textureSample(tex, texSampler, in.uv);

  // The final color is a mix between the instance color (for solid rects)
  // and the instance color modulated by the texture color (for images/text).
  let texturedResult = in.color * texColor;

  let useTexture = step(0.0, in.params.w);

  // mix(a, b, t) is equivalent to a * (1.0 - t) + b * t.
  let finalColor = mix(in.color, texturedResult, useTexture);
  
  return finalColor;
}
