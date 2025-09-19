// src/app/editor-widgets/fogWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import {
  EngineStateContext,
  setFogEnabled,
  setFogColor,
  setFogParams,
} from "@/core/engineState";

export function render(
  engineStateCtx: EngineStateContext,
  uiState: {
    fogEnabledUI: boolean;
    fogColorUI: [number, number, number];
    fogDensityUI: number;
    fogHeightUI: number;
    fogFalloffUI: number;
    fogInscatterUI: number;
  },
  engineReady: boolean,
): void {
  if (ImGui.CollapsingHeader("Fog", ImGui.TreeNodeFlags.DefaultOpen)) {
    const fogEnabledRef: [boolean] = [uiState.fogEnabledUI];
    if (ImGui.Checkbox("Enabled##Fog", fogEnabledRef) && engineReady) {
      uiState.fogEnabledUI = fogEnabledRef[0];
      setFogEnabled(engineStateCtx, uiState.fogEnabledUI);
    }

    const fogColorRef: [number, number, number] = [
      uiState.fogColorUI[0],
      uiState.fogColorUI[1],
      uiState.fogColorUI[2],
    ];
    if (ImGui.ColorEdit3("Color##Fog", fogColorRef) && engineReady) {
      uiState.fogColorUI = [fogColorRef[0], fogColorRef[1], fogColorRef[2]];
      setFogColor(
        engineStateCtx,
        uiState.fogColorUI[0],
        uiState.fogColorUI[1],
        uiState.fogColorUI[2],
        1.0,
      );
    }

    const densityRef: [number] = [uiState.fogDensityUI];
    if (
      ImGui.SliderFloat("Density##Fog", densityRef, 0.0, 1.0) &&
      engineReady
    ) {
      uiState.fogDensityUI = densityRef[0];
      setFogParams(
        engineStateCtx,
        uiState.fogDensityUI,
        uiState.fogHeightUI,
        uiState.fogFalloffUI,
        uiState.fogInscatterUI,
      );
    }

    const heightRef: [number] = [uiState.fogHeightUI];
    if (
      ImGui.SliderFloat("Height##Fog", heightRef, -50.0, 50.0) &&
      engineReady
    ) {
      uiState.fogHeightUI = heightRef[0];
      setFogParams(
        engineStateCtx,
        uiState.fogDensityUI,
        uiState.fogHeightUI,
        uiState.fogFalloffUI,
        uiState.fogInscatterUI,
      );
    }
    const falloffRef: [number] = [uiState.fogFalloffUI];
    if (
      ImGui.SliderFloat("Height Falloff##Fog", falloffRef, 0.0, 1.0) &&
      engineReady
    ) {
      uiState.fogFalloffUI = falloffRef[0];
      setFogParams(
        engineStateCtx,
        uiState.fogDensityUI,
        uiState.fogHeightUI,
        uiState.fogFalloffUI,
        uiState.fogInscatterUI,
      );
    }
    const inscatterRef: [number] = [uiState.fogInscatterUI];
    if (
      ImGui.SliderFloat("Inscatter Intensity##Fog", inscatterRef, 0.0, 10.0) &&
      engineReady
    ) {
      uiState.fogInscatterUI = inscatterRef[0];
      setFogParams(
        engineStateCtx,
        uiState.fogDensityUI,
        uiState.fogHeightUI,
        uiState.fogFalloffUI,
        uiState.fogInscatterUI,
      );
    }
  }
}
