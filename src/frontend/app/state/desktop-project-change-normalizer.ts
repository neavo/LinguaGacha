import { is_project_stage, type ProjectChangeEventForState } from "./desktop-project-change-types";
import { normalize_section_array, normalize_section_revisions } from "./desktop-event-payload";
import { is_json_record } from "@domain/json";
import type { ProjectItemsChange } from "@shared/project-event";

/** HTTP 与 SSE 的未校验字段，进入运行态前集中收窄。 */
export type ProjectChangeEventPayload = {
  eventId?: unknown;
  source?: unknown;
  projectPath?: unknown;
  projectRevision?: unknown;
  updatedSections?: unknown;
  items?: unknown;
  sectionRevisions?: unknown;
  qualityStatisticsScope?: unknown;
};

/** 通知在传输入口校验一次，之后沿用同一契约。 */
export function normalize_project_change_event(
  payload: ProjectChangeEventPayload,
): ProjectChangeEventForState | null {
  const project_path = typeof payload.projectPath === "string" ? payload.projectPath.trim() : "";
  const updated_sections = normalize_section_array(payload.updatedSections).filter(
    is_project_stage,
  );
  const scope = payload.qualityStatisticsScope;
  if (
    project_path === "" ||
    updated_sections.length === 0 ||
    typeof payload.eventId !== "string" ||
    payload.eventId === "" ||
    typeof payload.source !== "string" ||
    typeof payload.projectRevision !== "number" ||
    !Number.isFinite(payload.projectRevision) ||
    (scope !== "none" && scope !== "post_replacement" && scope !== "all")
  )
    return null;
  const items = normalize_project_change_items(payload.items);
  if (updated_sections.includes("items") && items === null) return null;
  return {
    eventId: payload.eventId,
    source: payload.source,
    projectPath: project_path,
    projectRevision: payload.projectRevision,
    updatedSections: updated_sections,
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions) ?? {},
    qualityStatisticsScope: scope,
    ...(items === null ? {} : { items }),
  };
}

/** 条目通知只接纳全量模式或正整数 ID，输入数组在入口隔离。 */
function normalize_project_change_items(value: unknown): ProjectItemsChange | null {
  if (!is_json_record(value)) return null;
  if (value.mode === "full") return { mode: "full" };
  if (
    value.mode !== "delta" ||
    !Array.isArray(value.changedIds) ||
    !value.changedIds.every(
      (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0,
    )
  )
    return null;
  return { mode: "delta", changedIds: [...new Set<number>(value.changedIds)] };
}
