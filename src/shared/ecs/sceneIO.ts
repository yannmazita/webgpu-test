// src/shared/ecs/sceneIO.ts
import { World } from "./world";
import { ResourceManager } from "@/core/resources/resourceManager";
import { TransformComponent } from "./components/transformComponent";
import { MeshRendererComponent } from "./components/meshRendererComponent";
import { LightComponent } from "./components/lightComponent";
import { HierarchyComponent } from "./components/hierarchyComponent";
import { setParent } from "./utils/hierarchy";
import { quat } from "wgpu-matrix";
import { PBRMaterialOptions } from "@/client/types/gpu";

export interface ValidationLimits {
  MAX_ENTITIES: number;
  MAX_ID_LEN: number;
  MAX_NAME_LEN: number;
  MAX_HANDLE_LEN: number;
  MAX_URL_LEN: number;
  POS_LIMIT: number;
  SCALE_LIMIT: number;
  RANGE_LIMIT: number;
  INTENSITY_LIMIT: number;
  MAX_TAGS_PER_ENTITY: number;
  MAX_TAG_LEN: number;
}

export interface ValidationOptions {
  allowNonUuidIds: boolean;
  allowRelativeUrls: boolean;
  allowUnknownComponents: boolean;
}

const DEFAULT_LIMITS: ValidationLimits = {
  MAX_ENTITIES: 10000,
  MAX_ID_LEN: 128,
  MAX_NAME_LEN: 256,
  MAX_HANDLE_LEN: 1024,
  MAX_URL_LEN: 2048,
  POS_LIMIT: 1e7,
  SCALE_LIMIT: 1e4,
  RANGE_LIMIT: 1e7,
  INTENSITY_LIMIT: 1e5,
  MAX_TAGS_PER_ENTITY: 64,
  MAX_TAG_LEN: 64,
};

const DEFAULT_OPTIONS: ValidationOptions = {
  allowNonUuidIds: false,
  allowRelativeUrls: true,
  allowUnknownComponents: false,
};

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function inRange(n: number, min: number, max: number): boolean {
  return n >= min && n <= max;
}
function isString(s: unknown): s is string {
  return typeof s === "string";
}
function ensureArray<T = unknown>(a: unknown, len: number): a is T[] {
  return Array.isArray(a) && a.length === len;
}

function validateUrl(
  s: string,
  limits: ValidationLimits,
  allowRelative: boolean,
): boolean {
  if (!isString(s) || s.length === 0 || s.length > limits.MAX_URL_LEN)
    return false;
  try {
    const u = new URL(s, allowRelative ? globalThis.location?.href : undefined);
    if (!allowRelative) {
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    } else {
      // allow relative with no protocol/host
      if (
        u.protocol &&
        u.protocol !== "http:" &&
        u.protocol !== "https:" &&
        u.protocol !== ":" // relative
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validatePrimHandle(
  handle: string,
  limits: ValidationLimits,
): string | null {
  if (handle.startsWith("PRIM:cube")) {
    const m = /size=([0-9]*\.?[0-9]+)/.exec(handle);
    if (m) {
      const size = parseFloat(m[1]);
      if (!Number.isFinite(size) || !inRange(size, 0.001, limits.SCALE_LIMIT)) {
        return "PRIM:cube size out of range";
      }
    }
    return null;
  }
  if (handle.startsWith("PRIM:icosphere")) {
    const rm = /r=([0-9]*\.?[0-9]+)/.exec(handle);
    const sm = /sub=([0-9]+)/.exec(handle);
    if (rm) {
      const r = parseFloat(rm[1]);
      if (!Number.isFinite(r) || !inRange(r, 0.001, limits.SCALE_LIMIT)) {
        return "PRIM:icosphere radius out of range";
      }
    }
    if (sm) {
      const sub = parseInt(sm[1], 10);
      if (!Number.isFinite(sub) || !inRange(sub, 0, 8)) {
        return "PRIM:icosphere subdivisions out of range (0..8)";
      }
    }
    return null;
  }
  return "Unsupported PRIM handle";
}

function validateMeshHandle(
  handle: string,
  limits: ValidationLimits,
  opts: ValidationOptions,
): string | null {
  if (
    !isString(handle) ||
    handle.length === 0 ||
    handle.length > limits.MAX_HANDLE_LEN
  ) {
    return "Mesh handle invalid length";
  }
  if (handle.startsWith("PRIM:")) {
    return validatePrimHandle(handle, limits);
  }
  if (handle.startsWith("OBJ:")) {
    const url = handle.slice(4);
    return validateUrl(url, limits, opts.allowRelativeUrls)
      ? null
      : "OBJ URL invalid";
  }
  if (handle.startsWith("STL:")) {
    const url = handle.slice(4);
    return validateUrl(url, limits, opts.allowRelativeUrls)
      ? null
      : "STL URL invalid";
  }
  return "Unsupported mesh handle";
}

function validatePbrOptions(
  opt: Partial<PBRMaterialOptions>,
  limits: ValidationLimits,
  opts: ValidationOptions,
): string | null {
  if (!opt || typeof opt !== "object") return "PBR options must be an object";
  const arr4 = (a: any) =>
    Array.isArray(a) && a.length === 4 && a.every(isFiniteNumber);
  const arr3 = (a: any) =>
    Array.isArray(a) && a.length === 3 && a.every(isFiniteNumber);

  if (opt.albedo && !arr4(opt.albedo))
    return "albedo must be [r,g,b,a] numbers";
  if (opt.metallic !== undefined && !isFiniteNumber(opt.metallic))
    return "metallic must be a number";
  if (opt.roughness !== undefined && !isFiniteNumber(opt.roughness))
    return "roughness must be a number";
  if (opt.normalIntensity !== undefined && !isFiniteNumber(opt.normalIntensity))
    return "normalIntensity must be a number";
  if (opt.emissive && !arr3(opt.emissive))
    return "emissive must be [r,g,b] numbers";
  if (
    opt.occlusionStrength !== undefined &&
    !isFiniteNumber(opt.occlusionStrength)
  )
    return "occlusionStrength must be a number";

  // Validate texture URLs (if present)
  const urlFields = [
    "albedoMap",
    "metallicRoughnessMap",
    "normalMap",
    "emissiveMap",
    "occlusionMap",
  ] as const;
  for (const k of urlFields) {
    if (opt[k] !== undefined) {
      if (!isString(opt[k])) return `${k} must be a string URL`;
      if (!validateUrl(opt[k], limits, opts.allowRelativeUrls))
        return `${k} URL invalid`;
    }
  }
  return null;
}

export interface PBRMaterialV1 {
  type: "PBR";
  options: PBRMaterialOptions;
}

export interface SceneEntityV1 {
  id: string; // UUID
  name?: string;
  components: {
    Transform?: {
      position: [number, number, number];
      rotationQuat: [number, number, number, number];
      scale: [number, number, number];
    };
    MeshRenderer?: {
      mesh: string; // handle: PRIM:/OBJ:/STL:
      material: PBRMaterialV1;
    };
    Light?: {
      color: [number, number, number, number];
      range: number;
      intensity: number;
      type: number;
    };
    Hierarchy?: {
      parent: string; // UUID
    };
    Tags?: string[];
  };
}

export interface SceneDocumentV1 {
  version: 1;
  entities: SceneEntityV1[];
}

/**
 * Validates a scene document against a set of limits and options.
 * @param doc The scene document to validate.
 * @param limitsPartial Optional partial limits to override the defaults.
 * @param optsPartial Optional partial options to override the defaults.
 * @returns A result object indicating success or failure.
 */
export function validateSceneDocument(
  doc: unknown,
  limitsPartial?: Partial<ValidationLimits>,
  optsPartial?: Partial<ValidationOptions>,
): { ok: true; doc: SceneDocumentV1 } | { ok: false; errors: string[] } {
  const limits = { ...DEFAULT_LIMITS, ...(limitsPartial ?? {}) };
  const opts = { ...DEFAULT_OPTIONS, ...(optsPartial ?? {}) };

  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["$: document must be an object"] };
  }
  const anyDoc = doc as { version: unknown; entities: unknown };
  if (anyDoc.version !== 1) {
    return { ok: false, errors: ["$.version: must be 1"] };
  }
  if (!Array.isArray(anyDoc.entities)) {
    return { ok: false, errors: ["$.entities: must be an array"] };
  }
  if (anyDoc.entities.length > limits.MAX_ENTITIES) {
    return {
      ok: false,
      errors: [`$.entities: exceeds MAX_ENTITIES=${limits.MAX_ENTITIES}`],
    };
  }

  // Pre-scan UUIDs
  const ids = new Set<string>();
  const allIds: string[] = [];

  for (let i = 0; i < anyDoc.entities.length; i++) {
    const ent = anyDoc.entities[i] as SceneEntityV1;
    if (!ent || typeof ent !== "object") {
      err(`$.entities[${i}]`, "must be an object");
      continue;
    }
    if (
      !isString(ent.id) ||
      ent.id.length === 0 ||
      ent.id.length > limits.MAX_ID_LEN
    ) {
      err(
        `$.entities[${i}].id`,
        "must be a non-empty string within length limit",
      );
    } else {
      if (!opts.allowNonUuidIds && !UUID_V4_RE.test(ent.id)) {
        err(`$.entities[${i}].id`, "must be a UUID v4");
      }
      if (ids.has(ent.id)) {
        err(`$.entities[${i}].id`, "duplicate id");
      } else {
        ids.add(ent.id);
        allIds.push(ent.id);
      }
    }
  }

  // Validate entities fully
  for (let i = 0; i < anyDoc.entities.length; i++) {
    const ent = anyDoc.entities[i] as SceneEntityV1;
    if (!ent || typeof ent !== "object") continue;

    if (ent.name !== undefined) {
      if (!isString(ent.name) || ent.name.length > limits.MAX_NAME_LEN) {
        err(`$.entities[${i}].name`, "must be a string within length limit");
      }
    }

    const comps = ent.components;
    if (!comps || typeof comps !== "object") {
      err(`$.entities[${i}].components`, "must be an object");
      continue;
    }

    const known = new Set([
      "Transform",
      "MeshRenderer",
      "Light",
      "Hierarchy",
      "Tags",
    ]);
    for (const k of Object.keys(comps)) {
      if (!known.has(k) && !opts.allowUnknownComponents) {
        err(`$.entities[${i}].components`, `unknown component "${k}"`);
      }
    }

    // Transform
    if (comps.Transform) {
      const t = comps.Transform;
      if (
        !ensureArray<number>(t.position, 3) ||
        !t.position.every(isFiniteNumber)
      ) {
        err(
          `$.entities[${i}].components.Transform.position`,
          "must be a [number,number,number]",
        );
      } else if (t.position.some((v) => Math.abs(v) > limits.POS_LIMIT)) {
        err(
          `$.entities[${i}].components.Transform.position`,
          `values exceed ±${limits.POS_LIMIT}`,
        );
      }
      if (
        !ensureArray<number>(t.rotationQuat, 4) ||
        !t.rotationQuat.every(isFiniteNumber)
      ) {
        err(
          `$.entities[${i}].components.Transform.rotationQuat`,
          "must be a [number,number,number,number]",
        );
      }
      if (!ensureArray<number>(t.scale, 3) || !t.scale.every(isFiniteNumber)) {
        err(
          `$.entities[${i}].components.Transform.scale`,
          "must be a [number,number,number]",
        );
      } else if (t.scale.some((v) => v <= 0 || v > limits.SCALE_LIMIT)) {
        err(
          `$.entities[${i}].components.Transform.scale`,
          `values must be >0 and <= ${limits.SCALE_LIMIT}`,
        );
      }
    }

    // MeshRenderer
    if (comps.MeshRenderer) {
      const mr = comps.MeshRenderer;
      if (!isString(mr.mesh)) {
        err(
          `$.entities[${i}].components.MeshRenderer.mesh`,
          "must be a string",
        );
      } else {
        const mErr = validateMeshHandle(mr.mesh, limits, opts);
        if (mErr) err(`$.entities[${i}].components.MeshRenderer.mesh`, mErr);
      }
      const mat = mr.material;
      if (!mat || typeof mat !== "object") {
        err(
          `$.entities[${i}].components.MeshRenderer.material`,
          "must be an object",
        );
      } else if (mat.type !== "PBR") {
        err(
          `$.entities[${i}].components.MeshRenderer.material.type`,
          "must be 'PBR'",
        );
      } else {
        const vErr = validatePbrOptions(mat.options, limits, opts);
        if (vErr) {
          err(
            `$.entities[${i}].components.MeshRenderer.material.options`,
            vErr,
          );
        }
      }
    }

    // Light
    if (comps.Light) {
      const lc = comps.Light;
      if (
        !ensureArray<number>(lc.color, 4) ||
        !lc.color.every(isFiniteNumber)
      ) {
        err(
          `$.entities[${i}].components.Light.color`,
          "must be [r,g,b,a] numbers",
        );
      }
      if (
        !isFiniteNumber(lc.range) ||
        !inRange(lc.range, 0.0001, limits.RANGE_LIMIT)
      ) {
        err(
          `$.entities[${i}].components.Light.range`,
          `must be in (0, ${limits.RANGE_LIMIT}]`,
        );
      }
      if (
        !isFiniteNumber(lc.intensity) ||
        !inRange(lc.intensity, 0, limits.INTENSITY_LIMIT)
      ) {
        err(
          `$.entities[${i}].components.Light.intensity`,
          `must be in [0, ${limits.INTENSITY_LIMIT}]`,
        );
      }
      if (!Number.isInteger(lc.type) || ![0, 1, 2].includes(lc.type)) {
        err(`$.entities[${i}].components.Light.type`, "must be 0, 1, or 2");
      }
    }

    // Hierarchy
    if (comps.Hierarchy) {
      const h = comps.Hierarchy;
      if (!isString(h.parent)) {
        err(
          `$.entities[${i}].components.Hierarchy.parent`,
          "must be a string id",
        );
      } else if (!ids.has(h.parent)) {
        err(
          `$.entities[${i}].components.Hierarchy.parent`,
          "parent id not found in document",
        );
      }
    }

    // Tags
    if (comps.Tags) {
      if (!Array.isArray(comps.Tags)) {
        err(`$.entities[${i}].components.Tags`, "must be an array of strings");
      } else {
        if (comps.Tags.length > limits.MAX_TAGS_PER_ENTITY) {
          err(
            `$.entities[${i}].components.Tags`,
            `exceeds ${limits.MAX_TAGS_PER_ENTITY}`,
          );
        }
        for (let ti = 0; ti < comps.Tags.length; ti++) {
          const t = comps.Tags[ti];
          if (!isString(t) || t.length > limits.MAX_TAG_LEN) {
            err(
              `$.entities[${i}].components.Tags[${ti}]`,
              "must be a string within length limit",
            );
          }
        }
      }
    }
  }

  // Cycle detection for hierarchy (unchanged)
  const parentOf = new Map<string, string>();
  for (const ent of anyDoc.entities) {
    const sceneEnt = ent as SceneEntityV1;
    if (sceneEnt?.components?.Hierarchy?.parent) {
      parentOf.set(sceneEnt.id, sceneEnt.components.Hierarchy.parent);
    }
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of allIds) color.set(id, WHITE);

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    const v = parentOf.get(u);
    if (v !== undefined) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) return true; // cycle
      if (c === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  }
  for (const id of allIds) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      if (dfs(id)) {
        errors.push("$.entities: hierarchy contains a cycle");
        break;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, doc: anyDoc as SceneDocumentV1 };
}

export interface SceneDocumentV1 {
  version: 1;
  entities: SceneEntityV1[];
}

export type SceneDocument = SceneDocumentV1;

// Serialize all non-global entities
/**
 * Serializes the state of the world into a scene document.
 * @param world The world to serialize.
 * @param rm The resource manager.
 * @returns The serialized scene document.
 */
export function serializeWorld(
  world: World,
  rm: ResourceManager,
): SceneDocumentV1 {
  const entities = world.query([]);
  const out: SceneEntityV1[] = [];
  for (const e of entities) {
    if (e === 0) continue; // skip global
    const uuid = world.getEntityUuid(e) ?? "";
    if (!uuid) continue;

    const t = world.getComponent(e, TransformComponent);
    const mr = world.getComponent(e, MeshRendererComponent);
    const li = world.getComponent(e, LightComponent);
    const hi = world.getComponent(e, HierarchyComponent);

    const comps: SceneEntityV1["components"] = {};

    if (t) {
      comps.Transform = {
        position: [t.position[0], t.position[1], t.position[2]],
        rotationQuat: [
          t.rotation[0],
          t.rotation[1],
          t.rotation[2],
          t.rotation[3],
        ],
        scale: [t.scale[0], t.scale[1], t.scale[2]],
      };
    }

    if (mr) {
      const meshHandle = rm.getHandleForMesh(mr.mesh);
      const matSpec = rm.getMaterialSpec(mr.material);
      if (!meshHandle || !matSpec) {
        console.warn(
          "serializeWorld: missing mesh/material spec; skipping MeshRenderer",
        );
      } else {
        comps.MeshRenderer = {
          mesh: meshHandle,
          material: matSpec,
        };
      }
    }

    if (li) {
      comps.Light = {
        color: [
          li.light.color[0],
          li.light.color[1],
          li.light.color[2],
          li.light.color[3],
        ],
        range: li.light.params0[0],
        intensity: li.light.params0[1],
        type: li.light.params0[2],
      };
    }

    if (hi && hi.parent !== null) {
      const puuid = world.getEntityUuid(hi.parent);
      if (puuid) {
        comps.Hierarchy = { parent: puuid };
      }
    }

    out.push({
      id: uuid,
      components: comps,
    });
  }

  return { version: 1, entities: out };
}

// Load into an existing world (clearing world is up to caller)
/**
 * Deserializes a scene document into the world.
 * @param doc The scene document to deserialize.
 * @param world The world to deserialize into.
 * @param rm The resource manager.
 * @param limitsPartial Optional partial limits to override the defaults.
 * @param optsPartial Optional partial options to override the defaults.
 */
export async function deserializeIntoWorld(
  doc: SceneDocument,
  world: World,
  rm: ResourceManager,
  limitsPartial?: Partial<ValidationLimits>,
  optsPartial?: Partial<ValidationOptions>,
): Promise<void> {
  const res = validateSceneDocument(doc, limitsPartial, optsPartial);
  if (!res.ok) {
    throw new Error(`Scene validation failed:\n${res.errors.join("\n")}`);
  }
  const vdoc = res.doc;

  const pendingParents: { childUuid: string; parentUuid: string }[] = [];

  for (const ent of vdoc.entities) {
    const e = world.createEntity(ent.id);

    const c = ent.components;

    if (c.Transform) {
      const t = new TransformComponent();
      const rq = c.Transform.rotationQuat;
      const nq = [rq[0], rq[1], rq[2], rq[3]] as [
        number,
        number,
        number,
        number,
      ];
      t.setPosition(...c.Transform.position);
      t.setRotation(quat.fromValues(nq[0], nq[1], nq[2], nq[3]));
      t.setScale(...c.Transform.scale);
      world.addComponent(e, t);
    }

    if (c.MeshRenderer) {
      const mesh = await rm.resolveMeshByHandle(c.MeshRenderer.mesh);
      const mat = await rm.resolveMaterialSpec(c.MeshRenderer.material);
      world.addComponent(e, new MeshRendererComponent(mesh, mat));
    }

    if (c.Light) {
      const lc = new LightComponent(
        c.Light.color,
        [0, 0, 0, 1],
        c.Light.range,
        c.Light.intensity,
        c.Light.type,
      );
      world.addComponent(e, lc);
    }

    if (c.Hierarchy?.parent) {
      pendingParents.push({
        childUuid: ent.id,
        parentUuid: c.Hierarchy.parent,
      });
    }
  }

  for (const link of pendingParents) {
    const childE = world.getEntityByUuid(link.childUuid);
    const parentE = world.getEntityByUuid(link.parentUuid);
    if (childE === undefined || parentE === undefined) {
      console.warn(
        "deserializeIntoWorld: hierarchy link skipped (missing entity)",
        link,
      );
      continue;
    }
    setParent(world, childE, parentE);
  }
}
