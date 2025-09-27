// src/app/editor-widgets/fogWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import {
  EngineStateContext,
  setFogEnabled,
  setFogColor,
  setFogParams,
  EngineSnapshot,
} from "@/core/engineState";

interface FogWidgetState {
  enabled: boolean;
  color: [number, number, number];
  density: number;
  height: number;
  falloff: number;
  inscatter: number;
}

export class FogWidget {
  private state: FogWidgetState = {
    enabled: true,
    color: [0.5, 0.6, 0.7],
    density: 0.02,
    height: 0.0,
    falloff: 0.1,
    inscatter: 0.8,
  };

  constructor(private engineStateCtx: EngineStateContext) {}

  public updateFromEngineSnapshot(snapshot: EngineSnapshot): void {
    this.state.enabled = snapshot.fog.enabled;
    this.state.color = [
      snapshot.fog.color[0],
      snapshot.fog.color[1],
      snapshot.fog.color[2],
    ];
    this.state.density = snapshot.fog.density;
    this.state.height = snapshot.fog.height;
    this.state.falloff = snapshot.fog.heightFalloff;
    this.state.inscatter = snapshot.fog.inscatteringIntensity;
  }

  public render(engineReady: boolean): void {
    if (ImGui.CollapsingHeader("Fog", ImGui.TreeNodeFlags.DefaultOpen)) {
      ImGui.BeginDisabled(!engineReady);

      const enabledRef: [boolean] = [this.state.enabled];
      if (ImGui.Checkbox("Enabled##Fog", enabledRef)) {
        this.state.enabled = enabledRef[0];
        setFogEnabled(this.engineStateCtx, this.state.enabled);
      }

      const colorRef: [number, number, number] = [...this.state.color];
      if (ImGui.ColorEdit3("Color##Fog", colorRef)) {
        this.state.color = [...colorRef];
        setFogColor(
          this.engineStateCtx,
          this.state.color[0],
          this.state.color[1],
          this.state.color[2],
          1.0,
        );
      }

      let paramsChanged = false;
      const densityRef: [number] = [this.state.density];
      if (ImGui.SliderFloat("Density##Fog", densityRef, 0.0, 1.0)) {
        this.state.density = densityRef[0];
        paramsChanged = true;
      }

      const heightRef: [number] = [this.state.height];
      if (ImGui.SliderFloat("Height##Fog", heightRef, -50.0, 50.0)) {
        this.state.height = heightRef[0];
        paramsChanged = true;
      }

      const falloffRef: [number] = [this.state.falloff];
      if (ImGui.SliderFloat("Height Falloff##Fog", falloffRef, 0.0, 1.0)) {
        this.state.falloff = falloffRef[0];
        paramsChanged = true;
      }

      const inscatterRef: [number] = [this.state.inscatter];
      if (
        ImGui.SliderFloat("Inscatter Intensity##Fog", inscatterRef, 0.0, 10.0)
      ) {
        this.state.inscatter = inscatterRef[0];
        paramsChanged = true;
      }

      if (paramsChanged) {
        setFogParams(
          this.engineStateCtx,
          this.state.density,
          this.state.height,
          this.state.falloff,
          this.state.inscatter,
        );
      }

      ImGui.EndDisabled();
    }
  }
}
