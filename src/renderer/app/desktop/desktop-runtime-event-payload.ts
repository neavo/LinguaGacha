import {
  is_project_runtime_stage,
  type ProjectRuntimeSectionRevisions,
} from "@/app/desktop/desktop-project-change-types";
import { JsonTool } from "../../../shared/utils/json-tool";

/**
 * SSE payload 解析失败时返回空对象，事件消费层再按缺字段语义做恢复。
 */
export function parse_event_payload(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JsonTool.parseStrict<Record<string, unknown>>(event.data);
  } catch {
    return {};
  }
}

/**
 * 事件数组字段统一去空白和空字符串，避免下游把脏 section 名当作刷新范围。
 */
export function normalize_string_array(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry !== "");
}

/**
 * section 数组当前等同普通字符串数组，单独函数保留项目事件语义。
 */
export function normalize_section_array(value: unknown): string[] {
  return normalize_string_array(value);
}

/**
 * section revision 只接受公开项目 section 和有限数字，非法字段会触发后续权威 query 恢复。
 */
export function normalize_section_revisions(
  value: unknown,
): ProjectRuntimeSectionRevisions | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw_entries = Object.entries(value as Record<string, unknown>);
  const section_revisions: Record<string, number> = {};
  for (const [section, revision] of raw_entries) {
    if (!is_project_runtime_stage(section)) {
      continue;
    }

    const normalized_revision = Number(revision);
    if (!Number.isFinite(normalized_revision)) {
      continue;
    }

    section_revisions[section] = normalized_revision;
  }

  if (Object.keys(section_revisions).length === 0) {
    return undefined;
  }

  return section_revisions;
}
