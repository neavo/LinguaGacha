import {
  createProjectStoreReplaceSectionPatch,
  type ProjectStorePatchOperation,
  type ProjectStoreProofreadingState,
  type ProjectStoreSectionRevisions,
  type ProjectStoreState,
} from "@/app/project/store/project-store";

type ProofreadingStoreItem = {
  item_id: number;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  status: string;
  text_type: string;
  retry_count: number;
};

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
  project_status: string;
  task_snapshot: Record<string, unknown>;
};

export type ProofreadingMutationPlan = {
  changed_item_ids: number[];
  patch: ProjectStorePatchOperation[];
  request_body: {
    items: ProofreadingFinalizedItemPayload[];
    translation_extras: Record<string, unknown>;
    project_status: string;
    expected_section_revisions: ProjectStoreSectionRevisions;
  };
};

const TRACKED_PROGRESS_STATUSES = new Set(["NONE", "PROCESSED", "ERROR"]);
const TASK_ONLY_KEYS = new Set([
  "task_type",
  "status",
  "busy",
  "request_in_flight_count",
  "analysis_candidate_count",
]);

function normalize_store_item(value: unknown): ProofreadingStoreItem | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0);
  if (!Number.isInteger(item_id)) {
    return null;
  }

  return {
    item_id,
    file_path: String(candidate.file_path ?? ""),
    row_number: Number(candidate.row_number ?? candidate.row ?? 0),
    src: String(candidate.src ?? ""),
    dst: String(candidate.dst ?? ""),
    status: String(candidate.status ?? ""),
    text_type: String(candidate.text_type ?? "NONE"),
    retry_count: Number(candidate.retry_count ?? 0),
  };
}

function clone_store_item(item: ProofreadingStoreItem): ProofreadingStoreItem {
  return {
    ...item,
  };
}

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

function resolve_status_after_manual_edit(old_status: string, new_dst: string): string {
  if (old_status === "PROCESSED_IN_PAST") {
    return "PROCESSED";
  }

  if (new_dst === "") {
    return old_status;
  }

  if (old_status === "PROCESSED") {
    return old_status;
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
  next_item_index: Map<number, ProofreadingStoreItem>;
}): ProofreadingDerivedState {
  let processed_line = 0;
  let error_line = 0;
  let total_line = 0;
  let has_pending_item = false;

  for (const item of args.next_item_index.values()) {
    if (item.status === "PROCESSED") {
      processed_line += 1;
    }
    if (item.status === "ERROR") {
      error_line += 1;
    }
    if (item.status === "NONE") {
      has_pending_item = true;
    }
    if (TRACKED_PROGRESS_STATUSES.has(item.status)) {
      total_line += 1;
    }
  }

  const translation_extras = build_translation_extras_from_task(args.state.task);
  translation_extras.processed_line = processed_line;
  translation_extras.error_line = error_line;
  translation_extras.total_line = total_line;
  translation_extras.line = processed_line + error_line;

  const project_status = total_line <= 0 ? "NONE" : has_pending_item ? "PROCESSING" : "PROCESSED";

  return {
    translation_extras,
    project_status,
    task_snapshot: {
      ...args.state.task,
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
  changed_items: ProofreadingStoreItem[];
  next_item_index: Map<number, ProofreadingStoreItem>;
}): ProofreadingMutationPlan | null {
  if (args.changed_items.length === 0) {
    return null;
  }

  const changed_item_ids = args.changed_items.map((item) => item.item_id);
  const derived_state = build_derived_state({
    state: args.state,
    next_item_index: args.next_item_index,
  });
  const proofreading_revision = Number(args.state.proofreading.revision ?? 0) + 1;
  const next_proofreading_state: ProjectStoreProofreadingState = {
    revision: proofreading_revision,
  };

  return {
    changed_item_ids,
    patch: [
      {
        op: "merge_items",
        items: args.changed_items.map((item) => {
          return {
            item_id: item.item_id,
            file_path: item.file_path,
            row_number: item.row_number,
            src: item.src,
            dst: item.dst,
            status: item.status,
            text_type: item.text_type,
            retry_count: item.retry_count,
          };
        }),
      },
      createProjectStoreReplaceSectionPatch("proofreading", next_proofreading_state),
      createProjectStoreReplaceSectionPatch("task", derived_state.task_snapshot),
    ],
    request_body: {
      items: args.changed_items.map((item) => build_finalized_item_payload(item)),
      translation_extras: derived_state.translation_extras,
      project_status: derived_state.project_status,
      expected_section_revisions: {
        items: args.state.revisions.sections.items ?? 0,
        proofreading: args.state.revisions.sections.proofreading ?? 0,
      },
    },
  };
}

export function create_save_item_plan(args: {
  state: ProjectStoreState;
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
    changed_items: [next_item],
    next_item_index: item_index,
  });
}

export function create_replace_all_plan(args: {
  state: ProjectStoreState;
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
    changed_items,
    next_item_index: item_index,
  });
}

export function create_reset_items_plan(args: {
  state: ProjectStoreState;
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
    changed_items,
    next_item_index: item_index,
  });
}
