import type { ProjectEvent, ProjectEventType } from "../project/project-events";
import type {
  ProjectChangeItemFieldPatch,
  ProjectChangeItemsPayload,
  ProjectDataSection,
  ProjectDataSectionRevisions,
} from "../../shared/project-event";

export type CacheItemChange =
  | { mode: "keep" }
  | { mode: "full"; reason: "invalidated" | "missing-range" | "full-scope" }
  | {
      mode: "delta";
      changedIds: number[];
      deleteIds: number[];
      fieldPatch: ProjectChangeItemFieldPatch | null;
      sourcePayloadMode: "canonical-delta" | "field-patch";
    };

export type CacheBlockChange = { mode: "keep" } | { mode: "full" };

export type CacheChange = {
  eventType: ProjectEventType;
  projectPath: string;
  source: string;
  affectedSections: ProjectDataSection[];
  sectionRevisions: ProjectDataSectionRevisions;
  fullRebuild: boolean;
  items: CacheItemChange;
  files: CacheBlockChange;
  quality: CacheBlockChange;
  prompts: CacheBlockChange;
  settings: CacheBlockChange;
  analysis: CacheBlockChange;
};

const KEEP: CacheBlockChange = { mode: "keep" };
const FULL: CacheBlockChange = { mode: "full" };

export function create_cache_change(event: ProjectEvent): CacheChange {
  const base = {
    eventType: event.type,
    projectPath: event.projectPath,
    source: event.source,
    affectedSections: [...event.affectedSections],
    sectionRevisions: { ...event.sectionRevisions },
  };

  if (event.type === "project.items.changed") {
    const items = resolve_item_change(event.items, event.scope, event.affectedSections);
    const files =
      affects_section(event.affectedSections, "files") || event.files !== undefined ? FULL : KEEP;
    return {
      ...base,
      fullRebuild: items.mode === "full" || files.mode === "full",
      items,
      files,
      quality: KEEP,
      prompts: KEEP,
      settings: KEEP,
      analysis: KEEP,
    };
  }

  return {
    ...base,
    fullRebuild: false,
    items: { mode: "keep" },
    files: KEEP,
    quality: event.type === "project.quality.changed" ? FULL : KEEP,
    prompts: event.type === "project.prompts.changed" ? FULL : KEEP,
    settings: event.type === "project.settings.changed" ? FULL : KEEP,
    analysis: event.type === "project.analysis.changed" ? FULL : KEEP,
  };
}

function resolve_item_change(
  payload: ProjectChangeItemsPayload | undefined,
  scope: "items-partial" | "items-full" | undefined,
  affected_sections: ProjectDataSection[],
): CacheItemChange {
  const affects_items = affects_section(affected_sections, "items");
  if (!affects_items && payload === undefined) {
    return { mode: "keep" };
  }
  if (scope === "items-full") {
    return { mode: "full", reason: "full-scope" };
  }
  if (payload === undefined) {
    return { mode: "full", reason: "missing-range" };
  }
  if (payload.payloadMode === "section-invalidated") {
    return { mode: "full", reason: "invalidated" };
  }

  const changed_ids = normalize_item_ids([
    ...Object.keys(payload.upsert ?? {}),
    ...(payload.changedIds ?? []),
  ]);
  const delete_ids = normalize_item_ids(payload.deleteIds ?? []);
  const field_patch =
    payload.payloadMode === "field-patch" && payload.fieldPatch !== undefined
      ? { ...payload.fieldPatch }
      : null;
  if (payload.payloadMode === "field-patch" && !has_item_field_patch(field_patch)) {
    return { mode: "full", reason: "missing-range" };
  }
  if (changed_ids.length === 0 && delete_ids.length === 0) {
    return { mode: "full", reason: "missing-range" };
  }
  return {
    mode: "delta",
    changedIds: changed_ids,
    deleteIds: delete_ids,
    fieldPatch: field_patch,
    sourcePayloadMode: payload.payloadMode,
  };
}

function affects_section(sections: ProjectDataSection[], section: ProjectDataSection): boolean {
  return sections.includes(section);
}

function has_item_field_patch(patch: ProjectChangeItemFieldPatch | null): boolean {
  return patch !== null && Object.keys(patch).length > 0;
}

function normalize_item_ids(values: Array<number | string>): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      ids.add(parsed);
    }
  }
  return [...ids];
}
