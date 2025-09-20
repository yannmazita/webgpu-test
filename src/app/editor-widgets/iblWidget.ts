// src/app/editor-widgets/iblWidget.ts
import { ImGui } from "@mori2003/jsimgui";

const HDR_LABELS = [
  "citrus_orchard_road_puresky_4k.hdr",
  "kloppenheim_02_puresky_4k.hdr",
  "lonely_road_afternoon_puresky_4k.hdr",
  "qwantani_night_puresky_4k.hdr",
  "small_empty_room_1_4k.hdr",
  "studio_small_09_4k.hdr",
] as const;

const HDR_PREFIX = "/assets/hdris/";

export function render(
  worker: Worker,
  uiState: {
    iblSelectedIndexUI: number;
    iblSizeUI: number;
  },
): void {
  if (
    ImGui.CollapsingHeader("Environment (IBL)", ImGui.TreeNodeFlags.DefaultOpen)
  ) {
    // HDR selection
    const current = uiState.iblSelectedIndexUI;
    const currentLabel = HDR_LABELS[current] ?? HDR_LABELS[0];
    if (ImGui.BeginCombo("HDR", currentLabel)) {
      for (let i = 0; i < HDR_LABELS.length; i++) {
        const isSelected = current === i;
        if (ImGui.Selectable(HDR_LABELS[i], isSelected)) {
          uiState.iblSelectedIndexUI = i;
        }
        if (isSelected) ImGui.SetItemDefaultFocus();
      }
      ImGui.EndCombo();
    }

    // Cubemap size (powers of two)
    const sizes = [128, 256, 512, 1024, 2048, 4096, 8192];
    const sizeLabel = `${uiState.iblSizeUI}`;
    if (ImGui.BeginCombo("Cubemap Size", sizeLabel)) {
      for (const s of sizes) {
        const isSelected = uiState.iblSizeUI === s;
        if (ImGui.Selectable(`${s}`, isSelected)) {
          uiState.iblSizeUI = s;
        }
        if (isSelected) ImGui.SetItemDefaultFocus();
      }
      ImGui.EndCombo();
    }

    if (ImGui.Button("Load Environment")) {
      const file = HDR_LABELS[uiState.iblSelectedIndexUI] ?? HDR_LABELS[0];
      const url = `${HDR_PREFIX}${file}`;
      worker.postMessage({
        type: "SET_ENVIRONMENT",
        url,
        size: uiState.iblSizeUI,
      });
    }
  }
}
