// src/app/editor-widgets/sunWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import {
  EngineStateContext,
  setSunEnabled,
  setSunColorAndIntensity,
  setSunDirection,
  setSunCastsShadows,
  EngineSnapshot,
} from "@/shared/state/engineState";

function yawPitchDegToDir(
  yawDeg: number,
  pitchDeg: number,
): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cp = Math.cos(pitch);
  const x = cp * Math.cos(yaw);
  const y = Math.sin(pitch);
  const z = cp * Math.sin(yaw);
  return [x, y, z];
}

function dirToYawPitchDeg(
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  const pitch = Math.asin(Math.max(-1, Math.min(1, y)));
  const yaw = Math.atan2(z, x);
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}

interface SunWidgetState {
  enabled: boolean;
  color: [number, number, number];
  intensity: number;
  yawDeg: number;
  pitchDeg: number;
  castsShadows: boolean;
}

export class SunWidget {
  private state: SunWidgetState = {
    enabled: true,
    color: [1, 1, 1],
    intensity: 1.0,
    yawDeg: -26,
    pitchDeg: -50,
    castsShadows: true,
  };

  constructor(private engineStateCtx: EngineStateContext) {}

  public updateFromEngineSnapshot(snapshot: EngineSnapshot): void {
    this.state.enabled = snapshot.sun.enabled;
    this.state.color = [
      snapshot.sun.color[0],
      snapshot.sun.color[1],
      snapshot.sun.color[2],
    ];
    this.state.intensity = snapshot.sun.intensity;
    const { yaw, pitch } = dirToYawPitchDeg(
      snapshot.sun.direction[0],
      snapshot.sun.direction[1],
      snapshot.sun.direction[2],
    );
    this.state.yawDeg = yaw;
    this.state.pitchDeg = pitch;
    this.state.castsShadows = snapshot.sun.castsShadows;
  }

  public render(engineReady: boolean): void {
    if (ImGui.CollapsingHeader("Sun", ImGui.TreeNodeFlags.DefaultOpen)) {
      ImGui.BeginDisabled(!engineReady);

      const enabledRef: [boolean] = [this.state.enabled];
      if (ImGui.Checkbox("Enabled##Sun", enabledRef)) {
        this.state.enabled = enabledRef[0];
        setSunEnabled(this.engineStateCtx, this.state.enabled);
      }

      const castsShadowsRef: [boolean] = [this.state.castsShadows];
      if (ImGui.Checkbox("Casts Shadows##Sun", castsShadowsRef)) {
        this.state.castsShadows = castsShadowsRef[0];
        setSunCastsShadows(this.engineStateCtx, this.state.castsShadows);
      }

      let colorOrIntensityChanged = false;
      const colorRef: [number, number, number] = [...this.state.color];
      if (ImGui.ColorEdit3("Color##Sun", colorRef)) {
        this.state.color = [...colorRef];
        colorOrIntensityChanged = true;
      }

      const intensityRef: [number] = [this.state.intensity];
      if (ImGui.SliderFloat("Intensity##Sun", intensityRef, 0.0, 50.0)) {
        this.state.intensity = intensityRef[0];
        colorOrIntensityChanged = true;
      }

      if (colorOrIntensityChanged) {
        setSunColorAndIntensity(
          this.engineStateCtx,
          this.state.color[0],
          this.state.color[1],
          this.state.color[2],
          this.state.intensity,
        );
      }

      let anglesChanged = false;
      const yawRef: [number] = [this.state.yawDeg];
      if (ImGui.SliderFloat("Yaw (deg)##Sun", yawRef, -180.0, 180.0)) {
        this.state.yawDeg = yawRef[0];
        anglesChanged = true;
      }

      const pitchRef: [number] = [this.state.pitchDeg];
      if (ImGui.SliderFloat("Pitch (deg)##Sun", pitchRef, -89.9, 89.9)) {
        this.state.pitchDeg = pitchRef[0];
        anglesChanged = true;
      }

      if (anglesChanged) {
        const [dx, dy, dz] = yawPitchDegToDir(
          this.state.yawDeg,
          this.state.pitchDeg,
        );
        setSunDirection(this.engineStateCtx, dx, dy, dz);
      }

      if (ImGui.TreeNode("Advanced Vector (normalized)")) {
        const [dx, dy, dz] = yawPitchDegToDir(
          this.state.yawDeg,
          this.state.pitchDeg,
        );
        ImGui.Text(`Dir: ${dx.toFixed(3)}, ${dy.toFixed(3)}, ${dz.toFixed(3)}`);
        ImGui.TreePop();
      }

      ImGui.EndDisabled();
    }
  }
}
