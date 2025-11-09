// src/shared/ecs/components/gameplay/lightComponent.ts
import { Light } from "@/shared/types/geometry";
import { vec4 } from "wgpu-matrix";
import { IComponent } from "@/shared/ecs/component";

export class LightComponent implements IComponent {
  public light: Light;

  constructor(
    color: [number, number, number, number] = [1, 1, 1, 1],
    position: [number, number, number, number] = [0, 0, 0, 1],
    range = 10.0,
    intensity = 1.0,
    type = 0,
  ) {
    this.light = {
      color: vec4.fromValues(...color),
      position: vec4.fromValues(...position),
      params0: vec4.fromValues(range, intensity, type, 0.0),
    };
  }
}
