import type { ProjectFileRecord } from "./project-file-records";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { ProjectPrefilterSettings } from "../../domain/project-settings";

import { should_skip_by_language_prefilter } from "../../shared/prefilter/language-prefilter";
import { read_item_translation_candidates } from "../../shared/prefilter/item-prefilter";
import { coordinate_project_duplicate_statuses } from "../../shared/project/project-item-duplicates";

export type ProjectWriteState = {
  files: Record<string, ProjectFileRecord>; // 按 `rel_path` 索引的完整文件集合。
  items: Record<string, ProjectItemPublicRecord>; // 读取或解析边界已收窄的完整公开条目
};

type ProjectPrefilterInput = ProjectPrefilterSettings & {
  state: ProjectWriteState;
  source_language: string;
};

/**
 * 将已收窄的条目集合转成按身份索引的独立条目快照。
 */
function copy_public_items(
  items: Record<string, ProjectItemPublicRecord>,
): Record<string, ProjectItemPublicRecord> {
  const result: Record<string, ProjectItemPublicRecord> = {};
  for (const item of Object.values(items)) {
    result[String(item.item_id)] = { ...item };
  }
  return result;
}

/**
 * 预过滤核心只接收后端权威项目快照，输出完整可写的计算事实。
 */
export function compute_project_prefilter_items(
  input: ProjectPrefilterInput,
): Record<string, ProjectItemPublicRecord> {
  const item_index = copy_public_items(input.state.items);
  const items = Object.values(item_index);

  const kvjson_items_by_path = new Map<string, ProjectItemPublicRecord[]>();

  for (const item of items) {
    const file_type = input.state.files[item.file_path]?.file_type;
    if (item.status === "LANGUAGE_SKIPPED" || item.status === "DUPLICATED") {
      item.status = "NONE";
    }
    // KVJSON 的 RULE_SKIPPED 可能来自可切换的 MTool 优化，需按通用规则和当前开关重算。
    if (item.status === "RULE_SKIPPED" && file_type === "KVJSON") {
      item.status = "NONE";
    }
    if (input.mtool_optimizer_enable && file_type === "KVJSON") {
      const current_group = kvjson_items_by_path.get(item.file_path);
      if (current_group === undefined) {
        kvjson_items_by_path.set(item.file_path, [item]);
      } else {
        current_group.push(item);
      }
    }
  }

  for (const item of items) {
    if (item.status !== "NONE" || item.skip_internal_filter) {
      continue;
    }
    const candidates = read_item_translation_candidates(item);
    if (candidates.length === 0) {
      item.status = "RULE_SKIPPED";
      continue;
    }
    if (
      candidates.every((part) =>
        should_skip_by_language_prefilter(part.text, input.source_language),
      )
    ) {
      item.status = "LANGUAGE_SKIPPED";
    }
  }

  if (input.mtool_optimizer_enable) {
    for (const file_items of kvjson_items_by_path.values()) {
      const target_clauses = new Set<string>();
      for (const item of file_items) {
        if (!item.src.includes("\n")) {
          continue;
        }
        for (const line of item.src.split(/\r\n|\r|\n/gu)) {
          const normalized_line = line.trim();
          if (normalized_line !== "") {
            target_clauses.add(normalized_line);
          }
        }
      }

      for (const item of file_items) {
        if (item.status !== "NONE" || !target_clauses.has(item.src)) {
          continue;
        }
        item.status = "RULE_SKIPPED";
      }
    }
  }

  const duplicate_changes = coordinate_project_duplicate_statuses(
    items,
    input.skip_duplicate_source_text_enable,
  );
  for (const change of duplicate_changes) {
    const item = item_index[String(change.item_id)];
    if (item !== undefined) item.status = change.status;
  }

  return item_index;
}
