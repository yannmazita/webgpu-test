// src/app/editor-widgets/shadowWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import {
  EngineStateContext,
  setShadowMapSize,
  setShadowParams0,
  setShadowOrthoHalfExtent,
} from "@/core/engineState";

export function render(
  engineStateCtx: EngineStateContext,
  uiState: {
    shadowMapSizeUI: number;
    shadowSlopeScaleBiasUI: number;
    shadowConstantBiasUI: number;
    shadowDepthBiasUI: number;
    shadowPcfRadiusUI: number;
    shadowOrthoExtentUI: number;
  },
  engineReady: boolean,
): void {
  if (ImGui.CollapsingHeader("Shadows", ImGui.TreeNodeFlags.DefaultOpen)) {
    const sizes = [256, 512, 1024, 2048, 4096, 8192];

    const currentLabel = `${uiState.shadowMapSizeUI}`;
    if (ImGui.BeginCombo("Map Size", currentLabel)) {
      for (const size of sizes) {
        const label = `${size}`;
        const isSelected = uiState.shadowMapSizeUI === size;
        if (ImGui.Selectable(label, isSelected)) {
          uiState.shadowMapSizeUI = size;
          if (engineReady)
            setShadowMapSize(engineStateCtx, uiState.shadowMapSizeUI);
        }
        if (isSelected) ImGui.SetItemDefaultFocus();
      }
      ImGui.EndCombo();
    }

    const slopeRef: [number] = [uiState.shadowSlopeScaleBiasUI];
    const constRef: [number] = [uiState.shadowConstantBiasUI];
    const depthRef: [number] = [uiState.shadowDepthBiasUI];
    const pcfRef: [number] = [uiState.shadowPcfRadiusUI];
    let changedShadow0 = false;

    if (ImGui.SliderFloat("Slope Scale Bias", slopeRef, 0.0, 16.0))
      changedShadow0 = true;
    if (ImGui.SliderFloat("Constant Bias", constRef, 0.0, 4096.0))
      changedShadow0 = true;
    if (ImGui.SliderFloat("Depth Bias", depthRef, 0.0, 0.02))
      changedShadow0 = true;
    if (ImGui.SliderFloat("PCF Radius", pcfRef, 0.0, 5.0))
      changedShadow0 = true;

    if (changedShadow0 && engineReady) {
      uiState.shadowSlopeScaleBiasUI = slopeRef[0];
      uiState.shadowConstantBiasUI = constRef[0];
      uiState.shadowDepthBiasUI = depthRef[0];
      uiState.shadowPcfRadiusUI = pcfRef[0];
      setShadowParams0(
        engineStateCtx,
        uiState.shadowSlopeScaleBiasUI,
        uiState.shadowConstantBiasUI,
        uiState.shadowDepthBiasUI,
        uiState.shadowPcfRadiusUI,
      );
    }

    const orthoRef: [number] = [uiState.shadowOrthoExtentUI];
    if (
      ImGui.SliderFloat("Ortho Half Extent", orthoRef, 1.0, 500.0) &&
      engineReady
    ) {
      uiState.shadowOrthoExtentUI = orthoRef[0];
      setShadowOrthoHalfExtent(engineStateCtx, uiState.shadowOrthoExtentUI);
    }
  }
}
