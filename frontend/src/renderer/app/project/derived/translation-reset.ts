import { compute_project_prefilter_mutation } from "@/app/project/derived/project-prefilter";
import {
  build_translation_task_and_project_state,
  clone_runtime_project_item_record,
  create_empty_translation_task_snapshot,
  normalize_runtime_project_item_record,
  type RuntimeProjectItemRecord,
} from "@/app/project/derived/reset-derived";
import {
  createProjectStoreReplaceSectionPatch,
  type ProjectStorePatchOperation,
  type ProjectStoreState,
} from "@/app/project/store/project-store";

type TranslationResetFullItemPayload = {
  id: number;
  src: string;
  dst: string;
  name_src: unknown;
  name_dst: unknown;
  extra_field: unknown;
  tag: string;
  row: number;
  file_type: string;
  file_path: string;
  text_type: string;
  status: string;
  retry_count: number;
};

type TranslationResetPreviewPayload = {
  items?: Array<Record<string, unknown>>;
};

export type TranslationResetPlan = {
  updatedSections: Array<"items" | "analysis" | "task"> | Array<"items" | "task">;
  patch: ProjectStorePatchOperation[];
  requestBody: Record<string, unknown>;
  next_task_snapshot: Record<string, unknown>;
};

function build_runtime_item_map(state: ProjectStoreState): Map<number, RuntimeProjectItemRecord> {
  const item_map = new Map<number, RuntimeProjectItemRecord>();
  for (const value of Object.values(state.items)) {
    const item = normalize_runtime_project_item_record(value);
    if (item === null) {
      continue;
    }
    item_map.set(item.item_id, clone_runtime_project_item_record(item));
  }
  return item_map;
}

function serialize_partial_items(
  items: RuntimeProjectItemRecord[],
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
    };
  });
}

function normalize_full_preview_item(
  value: Record<string, unknown>,
): TranslationResetFullItemPayload | null {
  const item_id = Number(value.id ?? value.item_id ?? 0);
  if (!Number.isInteger(item_id) || item_id <= 0) {
    return null;
  }

  return {
    id: item_id,
    src: String(value.src ?? ""),
    dst: String(value.dst ?? ""),
    name_src: value.name_src ?? null,
    name_dst: value.name_dst ?? null,
    extra_field: value.extra_field ?? "",
    tag: String(value.tag ?? ""),
    row: Number(value.row ?? value.row_number ?? 0),
    file_type: String(value.file_type ?? "NONE"),
    file_path: String(value.file_path ?? ""),
    text_type: String(value.text_type ?? "NONE"),
    status: String(value.status ?? "NONE"),
    retry_count: Number(value.retry_count ?? 0),
  };
}

function convert_full_preview_item_to_runtime_record(
  item: TranslationResetFullItemPayload,
): RuntimeProjectItemRecord {
  return {
    item_id: item.id,
    file_path: item.file_path,
    row_number: item.row,
    src: item.src,
    dst: item.dst,
    name_dst: item.name_dst ?? null,
    status: item.status,
    text_type: item.text_type,
    retry_count: item.retry_count,
  };
}

function merge_full_items_with_runtime_state(args: {
  preview_items: TranslationResetFullItemPayload[];
  runtime_items: Record<string, Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const runtime_items_by_id = new Map<number, RuntimeProjectItemRecord>();
  for (const value of Object.values(args.runtime_items)) {
    const runtime_item = normalize_runtime_project_item_record(value);
    if (runtime_item === null) {
      continue;
    }
    runtime_items_by_id.set(runtime_item.item_id, runtime_item);
  }

  return args.preview_items.map((item) => {
    const runtime_item = runtime_items_by_id.get(item.id);
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
      row: runtime_item.row_number,
      file_path: runtime_item.file_path,
      text_type: runtime_item.text_type,
      status: runtime_item.status,
      retry_count: runtime_item.retry_count,
    };
  });
}

export function create_translation_reset_failed_plan(args: {
  state: ProjectStoreState;
}): TranslationResetPlan {
  const item_map = build_runtime_item_map(args.state);
  const changed_items: RuntimeProjectItemRecord[] = [];

  for (const item of item_map.values()) {
    if (item.status !== "ERROR") {
      continue;
    }

    item.dst = "";
    item.status = "NONE";
    item.retry_count = 0;
    changed_items.push(clone_runtime_project_item_record(item));
  }

  changed_items.sort((left_item, right_item) => left_item.item_id - right_item.item_id);

  const derived_task_state = build_translation_task_and_project_state({
    task_snapshot: args.state.task,
    items: item_map,
    analysis_candidate_count: Number(
      args.state.analysis.candidate_count ?? args.state.task.analysis_candidate_count ?? 0,
    ),
  });

  return {
    updatedSections: ["items", "task"],
    patch: [
      {
        op: "merge_items",
        items: changed_items,
      },
      createProjectStoreReplaceSectionPatch("task", derived_task_state.task_snapshot),
    ],
    requestBody: {
      mode: "failed",
      items: serialize_partial_items(changed_items),
      translation_extras: derived_task_state.translation_extras,
      project_status: derived_task_state.project_status,
      expected_section_revisions: {
        items: args.state.revisions.sections.items ?? 0,
      },
    },
    next_task_snapshot: derived_task_state.task_snapshot,
  };
}

export async function create_translation_reset_all_plan(args: {
  state: ProjectStoreState;
  source_language: string;
  mtool_optimizer_enable: boolean;
  request_preview: () => Promise<TranslationResetPreviewPayload>;
}): Promise<TranslationResetPlan> {
  const preview_payload = await args.request_preview();
  const preview_items = (preview_payload.items ?? []).flatMap((item) => {
    const normalized_item =
      typeof item === "object" && item !== null
        ? normalize_full_preview_item(item as Record<string, unknown>)
        : null;
    return normalized_item === null ? [] : [normalized_item];
  });

  const preview_runtime_items: Record<string, Record<string, unknown>> = {};
  for (const item of preview_items) {
    const runtime_item = convert_full_preview_item_to_runtime_record(item);
    preview_runtime_items[String(runtime_item.item_id)] = {
      item_id: runtime_item.item_id,
      file_path: runtime_item.file_path,
      row_number: runtime_item.row_number,
      src: runtime_item.src,
      dst: runtime_item.dst,
      name_dst: runtime_item.name_dst ?? null,
      status: runtime_item.status,
      text_type: runtime_item.text_type,
      retry_count: runtime_item.retry_count,
    };
  }

  const mutation_output = compute_project_prefilter_mutation({
    state: {
      ...args.state,
      items: preview_runtime_items,
    },
    source_language: args.source_language,
    mtool_optimizer_enable: args.mtool_optimizer_enable,
  });
  const finalized_full_items = merge_full_items_with_runtime_state({
    preview_items,
    runtime_items: mutation_output.items,
  });
  const reset_item_map = build_runtime_item_map({
    ...args.state,
    items: mutation_output.items,
  });
  const reset_task_state = build_translation_task_and_project_state({
    task_snapshot: create_empty_translation_task_snapshot(),
    items: reset_item_map,
    analysis_candidate_count: 0,
  });

  return {
    updatedSections: ["items", "analysis", "task"],
    patch: [
      createProjectStoreReplaceSectionPatch("items", mutation_output.items),
      createProjectStoreReplaceSectionPatch("analysis", mutation_output.analysis),
      createProjectStoreReplaceSectionPatch("task", reset_task_state.task_snapshot),
    ],
    requestBody: {
      mode: "all",
      items: finalized_full_items,
      translation_extras: reset_task_state.translation_extras,
      project_status: reset_task_state.project_status,
      prefilter_config: mutation_output.prefilter_config,
      expected_section_revisions: {
        items: args.state.revisions.sections.items ?? 0,
        analysis: args.state.revisions.sections.analysis ?? 0,
      },
    },
    next_task_snapshot: reset_task_state.task_snapshot,
  };
}
