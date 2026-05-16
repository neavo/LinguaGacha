import {
  createProjectStoreItemsDeltaChange,
  createProjectStoreReplaceSectionChange,
  type ProjectStoreChangeOperation,
  type ProjectStoreProofreadingState,
  type ProjectStoreSectionRevisions,
  type ProjectStoreState,
} from "@/project/store/project-store";
import {
  Item,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "@base/item";
import { TASK_PROGRESS_STATUSES } from "@shared/task";

// 校对 planner 直接消费 ProjectStore 的完整公开 DTO，本地 upsert 不能降级成瘦身 item
type ProofreadingStoreItem = ProjectItemPublicRecord;

type ProofreadingFinalizedItemPayload = {
  id: number;
  file_path: string;
  row: number;
  src: string;
  dst: string;
  status: string;
  text_type: string;
  retry_count: number;
};

type ProofreadingDerivedState = {
  translation_extras: Record<string, unknown>;
  task_snapshot: Record<string, unknown>;
};

type ProofreadingPlannerTaskSnapshot = Record<string, unknown>;

export type ProofreadingMutationPlan = {
  changed_item_ids: number[];
  operations: ProjectStoreChangeOperation[];
  next_task_snapshot: Record<string, unknown>;
  request_body: {
    items: ProofreadingFinalizedItemPayload[];
    translation_extras: Record<string, unknown>;
    expected_section_revisions: ProjectStoreSectionRevisions;
  };
};

const TASK_ONLY_KEYS = new Set([
  "task_type",
  "status",
  "busy",
  "request_in_flight_count",
  "analysis_candidate_count",
]);

// 读取 store item 时沿用公开 DTO 校验，缺字段的旧形状不参与校对 mutation
function normalize_store_item(value: unknown): ProofreadingStoreItem | null {
  return normalize_project_item_public_record(value);
}

function clone_store_item(item: ProofreadingStoreItem): ProofreadingStoreItem {
  return {
    ...item,
  };
}

// 校对批量操作按 item_id 建索引，后续只复制并替换受影响条目
function build_store_item_index(state: ProjectStoreState): Map<number, ProofreadingStoreItem> {
  const item_index = new Map<number, ProofreadingStoreItem>();
  for (const value of Object.values(state.items)) {
    const item = normalize_store_item(value);
    if (item === null) {
      continue;
    }
    item_index.set(item.item_id, item);
  }
  return item_index;
}

function resolve_status_after_manual_edit(
  old_status: string,
  new_dst: string,
): ProjectItemPublicRecord["status"] {
  // 清空译文时保留旧状态，手工写入译文统一视为已处理
  if (new_dst === "") {
    return Item.normalize_status(old_status);
  }

  if (old_status === "PROCESSED") {
    return "PROCESSED";
  }

  return "PROCESSED";
}

function create_replace_all_pattern(search_text: string, is_regex: boolean): RegExp {
  if (is_regex) {
    return new RegExp(search_text, "giu");
  }

  const escaped_search_text = search_text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(escaped_search_text, "giu");
}

function replace_all_in_text(args: {
  text: string;
  search_text: string;
  replace_text: string;
  is_regex: boolean;
}): { text: string; count: number } {
  if (!args.is_regex && args.search_text === "") {
    return {
      text: args.text,
      count: 0,
    };
  }

  const pattern = create_replace_all_pattern(args.search_text, args.is_regex);
  let count = 0;
  const next_text = args.text.replace(pattern, () => {
    count += 1;
    return args.replace_text;
  });
  return {
    text: next_text,
    count,
  };
}

function build_translation_extras_from_task(
  task_snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const translation_extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task_snapshot)) {
    if (TASK_ONLY_KEYS.has(key)) {
      continue;
    }
    translation_extras[key] = value;
  }
  return translation_extras;
}

function build_derived_state(args: {
  state: ProjectStoreState;
  task_snapshot?: ProofreadingPlannerTaskSnapshot;
  next_item_index: Map<number, ProofreadingStoreItem>;
}): ProofreadingDerivedState {
  let processed_line = 0;
  let error_line = 0;
  let total_line = 0;

  for (const item of args.next_item_index.values()) {
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

  const base_task_snapshot = args.task_snapshot ?? {};
  const translation_extras = build_translation_extras_from_task(base_task_snapshot);
  translation_extras.processed_line = processed_line;
  translation_extras.error_line = error_line;
  translation_extras.total_line = total_line;
  translation_extras.line = processed_line + error_line;

  return {
    translation_extras,
    task_snapshot: {
      ...base_task_snapshot,
      ...translation_extras,
    },
  };
}

function build_finalized_item_payload(
  item: ProofreadingStoreItem,
): ProofreadingFinalizedItemPayload {
  return {
    id: item.item_id,
    file_path: item.file_path,
    row: item.row_number,
    src: item.src,
    dst: item.dst,
    status: item.status,
    text_type: item.text_type,
    retry_count: item.retry_count,
  };
}

function build_mutation_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: ProofreadingPlannerTaskSnapshot;
  changed_items: ProofreadingStoreItem[];
  next_item_index: Map<number, ProofreadingStoreItem>;
}): ProofreadingMutationPlan | null {
  if (args.changed_items.length === 0) {
    return null;
  }

  // 本地 store 回流使用完整 DTO，后端 request 仍是局部 patch
  const changed_item_ids = args.changed_items.map((item) => item.item_id);
  const derived_state = build_derived_state({
    state: args.state,
    task_snapshot: args.task_snapshot,
    next_item_index: args.next_item_index,
  });
  const proofreading_revision = Number(args.state.proofreading.revision ?? 0) + 1;
  const next_proofreading_state: ProjectStoreProofreadingState = {
    revision: proofreading_revision,
  };

  return {
    changed_item_ids,
    operations: [
      createProjectStoreItemsDeltaChange({
        upsertItems: args.changed_items.map((item) => ({ ...item })),
      }),
      createProjectStoreReplaceSectionChange("proofreading", next_proofreading_state),
    ],
    next_task_snapshot: derived_state.task_snapshot,
    request_body: {
      items: args.changed_items.map((item) => build_finalized_item_payload(item)),
      translation_extras: derived_state.translation_extras,
      expected_section_revisions: {
        items: args.state.revisions.sections.items ?? 0,
        proofreading: args.state.revisions.sections.proofreading ?? 0,
      },
    },
  };
}

export function create_save_item_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: ProofreadingPlannerTaskSnapshot;
  item_id: number;
  next_dst: string;
}): ProofreadingMutationPlan | null {
  const item_index = build_store_item_index(args.state);
  const current_item = item_index.get(args.item_id);
  if (current_item === undefined) {
    return null;
  }

  if (current_item.dst === args.next_dst) {
    return null;
  }

  const next_item = clone_store_item(current_item);
  next_item.dst = args.next_dst;
  next_item.status = resolve_status_after_manual_edit(current_item.status, args.next_dst);
  item_index.set(next_item.item_id, next_item);
  return build_mutation_plan({
    state: args.state,
    task_snapshot: args.task_snapshot,
    changed_items: [next_item],
    next_item_index: item_index,
  });
}

export function create_replace_all_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: ProofreadingPlannerTaskSnapshot;
  item_ids: number[];
  search_text: string;
  replace_text: string;
  is_regex: boolean;
}): ProofreadingMutationPlan | null {
  const item_index = build_store_item_index(args.state);
  const changed_items: ProofreadingStoreItem[] = [];

  for (const item_id of args.item_ids) {
    const current_item = item_index.get(item_id);
    if (current_item === undefined) {
      continue;
    }

    const replace_result = replace_all_in_text({
      text: current_item.dst,
      search_text: args.search_text,
      replace_text: args.replace_text,
      is_regex: args.is_regex,
    });
    if (replace_result.count <= 0 || replace_result.text === current_item.dst) {
      continue;
    }

    const next_item = clone_store_item(current_item);
    next_item.dst = replace_result.text;
    next_item.status = resolve_status_after_manual_edit(current_item.status, replace_result.text);
    item_index.set(next_item.item_id, next_item);
    changed_items.push(next_item);
  }

  return build_mutation_plan({
    state: args.state,
    task_snapshot: args.task_snapshot,
    changed_items,
    next_item_index: item_index,
  });
}

export function create_reset_items_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: ProofreadingPlannerTaskSnapshot;
  item_ids: number[];
}): ProofreadingMutationPlan | null {
  const item_index = build_store_item_index(args.state);
  const changed_items: ProofreadingStoreItem[] = [];

  for (const item_id of args.item_ids) {
    const current_item = item_index.get(item_id);
    if (current_item === undefined) {
      continue;
    }
    if (current_item.dst === "" && current_item.status === "NONE") {
      continue;
    }

    const next_item = clone_store_item(current_item);
    next_item.dst = "";
    next_item.status = "NONE";
    next_item.retry_count = 0;
    item_index.set(next_item.item_id, next_item);
    changed_items.push(next_item);
  }

  return build_mutation_plan({
    state: args.state,
    task_snapshot: args.task_snapshot,
    changed_items,
    next_item_index: item_index,
  });
}
