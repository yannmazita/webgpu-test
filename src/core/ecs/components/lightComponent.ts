// src/core/ecs/components/lightComponent.ts
import { Light } from "@/core/types/gpu";
import { vec4 } from "wgpu-matrix";
import { IComponent } from "../component";

export class LightComponent implements IComponent {
  public light: Light;

  constructor(
    color: [number, number, number, number] = [1, 1, 1, 1],
    position: [number, number, number, number] = [0, 0, 0, 1],
  ) {
    this.light = {
      color: vec4.fromValues(...color),
      position: vec4.fromValues(...position),
    };
  }
}
