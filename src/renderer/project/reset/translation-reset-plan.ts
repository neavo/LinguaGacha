import { compute_project_prefilter_mutation } from "@/project/prefilter/prefilter-mutation-builder";
import {
  build_translation_task_and_project_state,
  clone_project_item_view_record,
  create_empty_translation_task_snapshot,
  derive_project_item_view_record,
  derive_project_item_view_record_from_public,
  type ProjectItemViewRecord,
} from "@/project/reset/reset-state-builders";
import {
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "@base/item";
import {
  createProjectStoreItemsDeltaChange,
  createProjectStoreReplaceSectionChange,
  type ProjectStoreChangeOperation,
  type ProjectStoreState,
} from "@/project/store/project-store";

type TranslationResetPreviewPayload = {
  items?: Array<Record<string, unknown>>;
};

export type TranslationResetPlan = {
  updatedSections: Array<"items" | "analysis"> | Array<"items">;
  operations: ProjectStoreChangeOperation[];
  requestBody: Record<string, unknown>;
  next_task_snapshot: Record<string, unknown>;
};

// ProjectStore.items 是完整事实镜像，reset 先按 item_id 建索引再派生视图
function build_public_item_map(state: ProjectStoreState): Map<number, ProjectItemPublicRecord> {
  const item_map = new Map<number, ProjectItemPublicRecord>();
  for (const value of Object.values(state.items)) {
    const item = normalize_project_item_public_record(value);
    if (item === null) {
      continue;
    }
    item_map.set(item.item_id, { ...item });
  }
  return item_map;
}

// 任务进度只消费轻量视图，避免把派生状态误当全量写回 payload
function build_item_view_map(
  public_items: Map<number, ProjectItemPublicRecord>,
): Map<number, ProjectItemViewRecord> {
  const item_map = new Map<number, ProjectItemViewRecord>();
  for (const item of public_items.values()) {
    item_map.set(item.item_id, derive_project_item_view_record_from_public(item));
  }
  return item_map;
}

// failed reset 的后端请求仍是局部 patch，由后端合并数据库事实
function serialize_partial_items(
  items: ProjectItemViewRecord[],
): Array<Record<string, unknown>> {
  return items.map((item) => {
    return {
      id: item.item_id,
      file_path: item.file_path,
      row: item.row_number,
      src: item.src,
      dst: item.dst,
      name_dst: item.name_dst ?? null,
      status: item.status,
      text_type: item.text_type,
      retry_count: item.retry_count,
      skip_internal_filter: item.skip_internal_filter,
    };
  });
}

// reset all 预览与预过滤输出都保留完整 DTO，只覆盖运行态字段
function merge_full_items_with_runtime_state(args: {
  preview_items: ProjectItemPublicRecord[];
  runtime_items: Record<string, ProjectItemPublicRecord>;
}): ProjectItemPublicRecord[] {
  const runtime_items_by_id = new Map<number, ProjectItemViewRecord>();
  for (const value of Object.values(args.runtime_items)) {
    const runtime_item = derive_project_item_view_record(value);
    if (runtime_item === null) {
      continue;
    }
    runtime_items_by_id.set(runtime_item.item_id, runtime_item);
  }

  return args.preview_items.map((item) => {
    const runtime_item = runtime_items_by_id.get(item.item_id);
    if (runtime_item === undefined) {
      return {
        ...item,
      };
    }

    return {
      ...item,
      src: runtime_item.src,
      dst: runtime_item.dst,
      name_dst: runtime_item.name_dst ?? null,
      row_number: runtime_item.row_number,
      file_path: runtime_item.file_path,
      text_type: runtime_item.text_type,
      status: runtime_item.status,
      retry_count: runtime_item.retry_count,
      skip_internal_filter: runtime_item.skip_internal_filter,
    };
  });
}

// 本地 optimistic upsert 必须用完整公开 DTO 加视图变化合成完整记录
function merge_public_item_with_view(
  item: ProjectItemPublicRecord,
  view: ProjectItemViewRecord,
): ProjectItemPublicRecord {
  return {
    ...item,
    file_path: view.file_path,
    row_number: view.row_number,
    src: view.src,
    dst: view.dst,
    name_dst: view.name_dst ?? null,
    status: view.status,
    text_type: view.text_type,
    retry_count: view.retry_count,
    skip_internal_filter: view.skip_internal_filter,
  };
}

export function create_translation_reset_failed_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
}): TranslationResetPlan {
  const task_snapshot = args.task_snapshot ?? create_empty_translation_task_snapshot();
  const public_item_map = build_public_item_map(args.state);
  const item_map = build_item_view_map(public_item_map);
  const changed_item_views: ProjectItemViewRecord[] = [];

  for (const item of item_map.values()) {
    if (item.status !== "ERROR") {
      continue;
    }

    item.dst = "";
    item.status = "NONE";
    item.retry_count = 0;
    changed_item_views.push(clone_project_item_view_record(item));
  }

  changed_item_views.sort((left_item, right_item) => left_item.item_id - right_item.item_id);
  const changed_items = changed_item_views.flatMap((item) => {
    const public_item = public_item_map.get(item.item_id);
    return public_item === undefined ? [] : [merge_public_item_with_view(public_item, item)];
  });

  const derived_task_state = build_translation_task_and_project_state({
    task_snapshot,
    items: item_map,
  });

  return {
    updatedSections: ["items"],
    operations: [createProjectStoreItemsDeltaChange({ upsertItems: changed_items })],
    requestBody: {
      mode: "failed",
      items: serialize_partial_items(changed_item_views),
      translation_extras: derived_task_state.translation_extras,
      expected_section_revisions: {
        items: args.state.revisions.sections.items ?? 0,
      },
    },
    next_task_snapshot: derived_task_state.task_snapshot,
  };
}

export async function create_translation_reset_all_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  source_language: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
  request_preview: () => Promise<TranslationResetPreviewPayload>;
}): Promise<TranslationResetPlan> {
  const preview_payload = await args.request_preview();
  const preview_items = (preview_payload.items ?? []).flatMap((item) => {
    const normalized_item =
      typeof item === "object" && item !== null
        ? normalize_project_item_public_record(item as Record<string, unknown>)
        : null;
    return normalized_item === null ? [] : [normalized_item];
  });

  const preview_runtime_items: Record<string, ProjectItemPublicRecord> = {};
  for (const item of preview_items) {
    preview_runtime_items[String(item.item_id)] = item;
  }

  const mutation_output = compute_project_prefilter_mutation({
    state: {
      ...args.state,
      items: preview_runtime_items,
    },
    task_snapshot: create_empty_translation_task_snapshot(),
    source_language: args.source_language,
    mtool_optimizer_enable: args.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: args.skip_duplicate_source_text_enable,
  });
  const finalized_full_items = merge_full_items_with_runtime_state({
    preview_items,
    runtime_items: mutation_output.items,
  });
  const reset_public_item_map = build_public_item_map({
    ...args.state,
    items: mutation_output.items,
  });
  const reset_item_map = build_item_view_map(reset_public_item_map);
  const reset_task_state = build_translation_task_and_project_state({
    task_snapshot: create_empty_translation_task_snapshot(),
    items: reset_item_map,
  });

  return {
    updatedSections: ["items", "analysis"],
    operations: [
      createProjectStoreReplaceSectionChange("items", mutation_output.items),
      createProjectStoreReplaceSectionChange("analysis", mutation_output.analysis),
    ],
    requestBody: {
      mode: "all",
      items: finalized_full_items,
      translation_extras: reset_task_state.translation_extras,
      prefilter_config: mutation_output.prefilter_config,
      expected_section_revisions: {
        items: args.state.revisions.sections.items ?? 0,
        analysis: args.state.revisions.sections.analysis ?? 0,
      },
    },
    next_task_snapshot: reset_task_state.task_snapshot,
  };
}
