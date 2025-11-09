// src/app/editor-widgets/selectionWidget.ts
import { ImGui } from "@mori2003/jsimgui";
import { RaycastResponseMsg } from "@/shared/types/worker";
import { Entity } from "@/shared/ecs/entity";
import { Vec3 } from "wgpu-matrix";

interface SelectedEntity {
  id: Entity;
  name: string;
  distance: number;
  point: Vec3;
}

export class SelectionWidget {
  private selectedEntity: SelectedEntity | null = null;

  public onRaycastResponse(msg: RaycastResponseMsg): void {
    if (msg.hit) {
      this.selectedEntity = {
        id: msg.hit.entity,
        name: msg.hit.entityName,
        distance: msg.hit.distance,
        point: msg.hit.point,
      };
    } else {
      this.selectedEntity = null;
    }
  }

  public render(): void {
    if (ImGui.CollapsingHeader("Selection", ImGui.TreeNodeFlags.DefaultOpen)) {
      if (this.selectedEntity) {
        ImGui.Text(`Entity ID: ${this.selectedEntity.id}`);
        ImGui.Text(`Name: ${this.selectedEntity.name}`);
        ImGui.Text(`Distance: ${this.selectedEntity.distance.toFixed(2)}`);
        ImGui.Text(
          `Point: ${this.selectedEntity.point[0].toFixed(2)}, ` +
            `${this.selectedEntity.point[1].toFixed(2)}, ` +
            `${this.selectedEntity.point[2].toFixed(2)}`,
        );
      } else {
        ImGui.Text("Nothing selected. Click on an object.");
      }
    }
    ImGui.Separator();
  }
}
