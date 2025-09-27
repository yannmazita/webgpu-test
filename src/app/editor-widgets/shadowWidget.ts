// src/app/editor-widgets/shadowWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import {
  EngineStateContext,
  setShadowMapSize,
  setShadowParams0,
  setShadowOrthoHalfExtent,
  EngineSnapshot,
} from "@/core/engineState";

interface ShadowWidgetState {
  mapSize: number;
  slopeScaleBias: number;
  constantBias: number;
  depthBias: number;
  pcfRadius: number;
  orthoExtent: number;
}

export class ShadowWidget {
  private state: ShadowWidgetState = {
    mapSize: 2048,
    slopeScaleBias: 3.0,
    constantBias: 1.0,
    depthBias: 0.0015,
    pcfRadius: 1.0,
    orthoExtent: 20.0,
  };

  constructor(private engineStateCtx: EngineStateContext) {}

  public updateFromEngineSnapshot(snapshot: EngineSnapshot): void {
    this.state.mapSize = snapshot.shadow.mapSize;
    this.state.slopeScaleBias = snapshot.shadow.slopeScaleBias;
    this.state.constantBias = snapshot.shadow.constantBias;
    this.state.depthBias = snapshot.shadow.depthBias;
    this.state.pcfRadius = snapshot.shadow.pcfRadius;
    this.state.orthoExtent = snapshot.shadow.orthoHalfExtent;
  }

  public render(engineReady: boolean): void {
    if (ImGui.CollapsingHeader("Shadows", ImGui.TreeNodeFlags.DefaultOpen)) {
      ImGui.BeginDisabled(!engineReady);

      const sizes = [256, 512, 1024, 2048, 4096, 8192];
      const currentLabel = `${this.state.mapSize}`;
      if (ImGui.BeginCombo("Map Size", currentLabel)) {
        for (const size of sizes) {
          const label = `${size}`;
          const isSelected = this.state.mapSize === size;
          if (ImGui.Selectable(label, isSelected)) {
            this.state.mapSize = size;
            setShadowMapSize(this.engineStateCtx, this.state.mapSize);
          }
          if (isSelected) ImGui.SetItemDefaultFocus();
        }
        ImGui.EndCombo();
      }

      let params0Changed = false;
      const slopeRef: [number] = [this.state.slopeScaleBias];
      if (ImGui.SliderFloat("Slope Scale Bias", slopeRef, 0.0, 16.0)) {
        this.state.slopeScaleBias = slopeRef[0];
        params0Changed = true;
      }

      const constRef: [number] = [this.state.constantBias];
      if (ImGui.SliderFloat("Constant Bias", constRef, 0.0, 4096.0)) {
        this.state.constantBias = constRef[0];
        params0Changed = true;
      }

      const depthRef: [number] = [this.state.depthBias];
      if (ImGui.SliderFloat("Depth Bias", depthRef, 0.0, 0.02)) {
        this.state.depthBias = depthRef[0];
        params0Changed = true;
      }

      const pcfRef: [number] = [this.state.pcfRadius];
      if (ImGui.SliderFloat("PCF Radius", pcfRef, 0.0, 5.0)) {
        this.state.pcfRadius = pcfRef[0];
        params0Changed = true;
      }

      if (params0Changed) {
        setShadowParams0(
          this.engineStateCtx,
          this.state.slopeScaleBias,
          this.state.constantBias,
          this.state.depthBias,
          this.state.pcfRadius,
        );
      }

      const orthoRef: [number] = [this.state.orthoExtent];
      if (ImGui.SliderFloat("Ortho Half Extent", orthoRef, 1.0, 500.0)) {
        this.state.orthoExtent = orthoRef[0];
        setShadowOrthoHalfExtent(this.engineStateCtx, this.state.orthoExtent);
      }

      ImGui.EndDisabled();
    }
  }
}
