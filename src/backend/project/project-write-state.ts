import type { ProjectFileRecord } from "./project-file-records";
import {
  normalize_batch_translation_progress,
  type BatchTranslationProgress,
  TASK_PROGRESS_STATUSES,
} from "../../domain/batch-translation";
import type { ProjectItemPublicRecord } from "../../domain/item";

import { should_skip_by_language_prefilter } from "../../shared/prefilter/language-prefilter";
import { read_item_translation_candidates } from "../../shared/prefilter/item-prefilter";
import { coordinate_project_duplicate_statuses } from "../../shared/project/project-item-duplicates";

export type ProjectWriteState = {
  files: Record<string, ProjectFileRecord>; // section 镜像，调用方需提供当前完整文件集合
  items: Record<string, ProjectItemPublicRecord>; // 读取或解析边界已收窄的完整公开条目
};

export type ProjectPrefilterWriteOutput = {
  items: Record<string, ProjectItemPublicRecord>; // 预过滤后的完整公开 item 集合
  translation_extras: BatchTranslationProgress; // 按最终 item 状态重建的翻译进度 meta
  prefilter_config: {
    source_language: string; // 旧项目读取仍需要的预过滤源语言镜像
    mtool_optimizer_enable: boolean; // 旧项目读取仍需要的 MTool 镜像
    skip_duplicate_source_text_enable: boolean; // 旧项目读取仍需要的重复过滤镜像
  };
};

export type ProjectPrefilterWriteInput = {
  state: ProjectWriteState; // 当前项目事实快照，调用方负责提供后端权威事实
  progress?: BatchTranslationProgress; // 缺省时从空翻译进度开始
  source_language: string; // 源语言预过滤口径
  mtool_optimizer_enable: boolean; // 是否启用 KVJSON 优化预过滤
  skip_duplicate_source_text_enable: boolean; // 是否启用重复项过滤
};

/**
 * 按最终 item 状态重建翻译进度 meta。任务生命周期由 BatchTranslationSnapshot 管理。
 */
export function build_translation_extras_from_items(args: {
  progress: BatchTranslationProgress;
  items: Iterable<Pick<ProjectItemPublicRecord, "status">>;
}): BatchTranslationProgress {
  let processed_line = 0;
  let error_line = 0;
  let total_line = 0;

  for (const item of args.items) {
    if (item.status === "PROCESSED") {
      processed_line += 1;
    }
    if (item.status === "ERROR") {
      error_line += 1;
    }
    if ((TASK_PROGRESS_STATUSES as readonly string[]).includes(item.status)) {
      total_line += 1;
    }
  }

  return {
    ...args.progress,
    processed_line,
    error_line,
    total_line,
    line: processed_line + error_line,
  };
}

/**
 * 将已收窄的条目集合转成按身份索引的独立姓名快照。
 */
function build_public_item_map(
  items: Record<string, ProjectItemPublicRecord>,
): Map<number, ProjectItemPublicRecord> {
  const item_map = new Map<number, ProjectItemPublicRecord>();
  for (const item of Object.values(items)) {
    item_map.set(item.item_id, {
      ...item,
      name_src: structuredClone(item.name_src),
      name_dst: structuredClone(item.name_dst),
    });
  }
  return item_map;
}

/**
 * 预过滤核心只接收后端权威项目快照，输出完整可写的计算事实。
 */
export function compute_project_prefilter_write(
  input: ProjectPrefilterWriteInput,
): ProjectPrefilterWriteOutput {
  const file_type_by_path = new Map<string, string>();
  for (const file of Object.values(input.state.files)) {
    file_type_by_path.set(file.rel_path, file.file_type);
  }

  const item_index = build_public_item_map(input.state.items);

  const kvjson_items_by_path = new Map<string, ProjectItemPublicRecord[]>();

  for (const item of item_index.values()) {
    const file_type = file_type_by_path.get(item.file_path);
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

  for (const item of item_index.values()) {
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
    [...item_index.values()],
    input.skip_duplicate_source_text_enable,
  );
  for (const change of duplicate_changes) {
    const item = item_index.get(change.item_id);
    if (item !== undefined) item.status = change.status;
  }
  const next_items = Object.fromEntries(
    [...item_index.values()].map((item) => [String(item.item_id), item]),
  );

  const translation_extras = build_translation_extras_from_items({
    progress: input.progress ?? normalize_batch_translation_progress(undefined),
    items: item_index.values(),
  });

  return {
    items: next_items,

    translation_extras,
    prefilter_config: {
      source_language: input.source_language,
      mtool_optimizer_enable: input.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: input.skip_duplicate_source_text_enable,
    },
  };
}
