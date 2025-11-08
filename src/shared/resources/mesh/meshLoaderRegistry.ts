// src/shared/resources/meshLoaderRegistry.ts
import { IMeshLoader } from "@/shared/resources/mesh/meshLoader";

/**
 * A registry for mapping resource prefixes (ie "OBJ", "PRIM" etc) to their
 * corresponding mesh loaders.
 */
export class MeshLoaderRegistry {
  private loaders = new Map<string, IMeshLoader>();

  /**
   * Registers a loader for a given resource prefix.
   * @param prefix The resource prefix (case-insensitive).
   * @param loader The loader instance.
   */
  public register(prefix: string, loader: IMeshLoader): void {
    this.loaders.set(prefix.toUpperCase(), loader);
  }

  /**
   * Retrieves a loader for a given resource prefix.
   * @param prefix The resource prefix.
   * @returns The loader instance, or undefined if not found.
   */
  public getLoader(prefix: string): IMeshLoader | undefined {
    return this.loaders.get(prefix.toUpperCase());
  }
}
