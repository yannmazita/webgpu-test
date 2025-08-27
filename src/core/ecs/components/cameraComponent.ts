// src/core/ecs/components/cameraComponent.ts
import { Camera } from "@/core/camera";
import { IComponent } from "../component";

export class CameraComponent implements IComponent {
  public camera: Camera;

  constructor(camera: Camera = new Camera()) {
    this.camera = camera;
  }
}
