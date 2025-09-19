// src/app/editor-widgets/renderingWidget.ts
import { ImGui } from "@mori2003/jsimgui";

export function render(
  worker: Worker,
  uiState: {
    toneMappingEnabledUI: boolean;
  },
): void {
  if (ImGui.CollapsingHeader("Rendering", ImGui.TreeNodeFlags.DefaultOpen)) {
    const toneMapRef: [boolean] = [uiState.toneMappingEnabledUI];
    if (ImGui.Checkbox("Tone Mapping (ACES)", toneMapRef)) {
      uiState.toneMappingEnabledUI = toneMapRef[0];
      worker.postMessage({
        type: "SET_TONE_MAPPING",
        enabled: uiState.toneMappingEnabledUI,
      });
    }
  }
}
