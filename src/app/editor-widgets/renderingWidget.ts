// src/app/editor-widgets/renderingWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import { EngineSnapshot } from "@/core/engineState";

interface RenderingWidgetState {
  toneMappingEnabled: boolean;
}

export class RenderingWidget {
  private state: RenderingWidgetState = {
    toneMappingEnabled: true,
  };

  constructor(private worker: Worker) {}

  public updateFromEngineSnapshot(_snapshot: EngineSnapshot): void {
    // NOTE: Tone mapping state is not currently in the engine snapshot.
    // The UI maintains its own state, and the worker has its own default.
  }

  public render(): void {
    if (ImGui.CollapsingHeader("Rendering", ImGui.TreeNodeFlags.DefaultOpen)) {
      const toneMapRef: [boolean] = [this.state.toneMappingEnabled];
      if (ImGui.Checkbox("Tone Mapping (ACES)", toneMapRef)) {
        this.state.toneMappingEnabled = toneMapRef[0];
        this.worker.postMessage({
          type: "SET_TONE_MAPPING",
          enabled: this.state.toneMappingEnabled,
        });
      }
    }
  }
}
