// src/app/editor-widgets/sunWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import {
  EngineStateContext,
  setSunEnabled,
  setSunColorAndIntensity,
  setSunDirection,
} from "@/core/engineState";

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

export function render(
  engineStateCtx: EngineStateContext,
  uiState: {
    sunEnabledUI: boolean;
    sunColorUI: [number, number, number];
    sunIntensityUI: number;
    sunYawDegUI: number;
    sunPitchDegUI: number;
  },
  engineReady: boolean,
): void {
  if (ImGui.CollapsingHeader("Sun", ImGui.TreeNodeFlags.DefaultOpen)) {
    const sunEnabledRef: [boolean] = [uiState.sunEnabledUI];
    if (ImGui.Checkbox("Enabled##Sun", sunEnabledRef) && engineReady) {
      uiState.sunEnabledUI = sunEnabledRef[0];
      setSunEnabled(engineStateCtx, uiState.sunEnabledUI);
    }

    const sunColorRef: [number, number, number] = [
      uiState.sunColorUI[0],
      uiState.sunColorUI[1],
      uiState.sunColorUI[2],
    ];
    if (ImGui.ColorEdit3("Color##Sun", sunColorRef) && engineReady) {
      uiState.sunColorUI = [sunColorRef[0], sunColorRef[1], sunColorRef[2]];
      setSunColorAndIntensity(
        engineStateCtx,
        uiState.sunColorUI[0],
        uiState.sunColorUI[1],
        uiState.sunColorUI[2],
        uiState.sunIntensityUI,
      );
    }

    const sunIntensityRef: [number] = [uiState.sunIntensityUI];
    if (
      ImGui.SliderFloat("Intensity##Sun", sunIntensityRef, 0.0, 50.0) &&
      engineReady
    ) {
      uiState.sunIntensityUI = sunIntensityRef[0];
      setSunColorAndIntensity(
        engineStateCtx,
        uiState.sunColorUI[0],
        uiState.sunColorUI[1],
        uiState.sunColorUI[2],
        uiState.sunIntensityUI,
      );
    }

    const yawRef: [number] = [uiState.sunYawDegUI];
    const pitchRef: [number] = [uiState.sunPitchDegUI];
    let changedAngles = false;
    if (ImGui.SliderFloat("Yaw (deg)##Sun", yawRef, -180.0, 180.0)) {
      changedAngles = true;
    }
    if (ImGui.SliderFloat("Pitch (deg)##Sun", pitchRef, -89.9, 89.9)) {
      changedAngles = true;
    }
    if (changedAngles && engineReady) {
      uiState.sunYawDegUI = yawRef[0];
      uiState.sunPitchDegUI = pitchRef[0];
      const [dx, dy, dz] = yawPitchDegToDir(
        uiState.sunYawDegUI,
        uiState.sunPitchDegUI,
      );
      setSunDirection(engineStateCtx, dx, dy, dz);
    }

    if (ImGui.TreeNode("Advanced Vector (normalized)")) {
      const [dx, dy, dz] = yawPitchDegToDir(
        uiState.sunYawDegUI,
        uiState.sunPitchDegUI,
      );
      ImGui.Text(`Dir: ${dx.toFixed(3)}, ${dy.toFixed(3)}, ${dz.toFixed(3)}`);
      ImGui.TreePop();
    }
  }
}
