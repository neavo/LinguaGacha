import { compute_project_prefilter_mutation } from "@/app/project/derived/project-prefilter";
import {
  createProjectStoreReplaceSectionPatch,
  type ProjectStorePatchOperation,
  type ProjectStoreState,
} from "@/app/project/store/project-store";

type WorkbenchPlannerSettings = {
  source_language: string;
  mtool_optimizer_enable: boolean;
};

type WorkbenchPlannerFileRecord = {
  rel_path: string;
  file_type: string;
  sort_index: number;
};

type WorkbenchPlannerItemRecord = {
  item_id: number;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  name_dst: unknown;
  status: string;
  text_type: string;
  retry_count: number;
};

export type WorkbenchTranslationInheritanceMode = "none" | "inherit";

type WorkbenchDerivedMeta = {
  translation_extras: Record<string, unknown>;
  project_status: string;
  prefilter_config: {
    source_language: string;
    mtool_optimizer_enable: boolean;
  };
};

export type WorkbenchProjectMutationPlan = {
  updatedSections: Array<"files" | "items" | "analysis" | "task">;
  patch: ProjectStorePatchOperation[];
  requestBody: Record<string, unknown>;
};

function normalize_file_record(value: unknown): WorkbenchPlannerFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as WorkbenchPlannerFileRecord).rel_path ?? "").trim(),
    file_type: String((value as WorkbenchPlannerFileRecord).file_type ?? "NONE"),
    sort_index: Number((value as WorkbenchPlannerFileRecord).sort_index ?? 0),
  };
}

function normalize_item_record(value: unknown): WorkbenchPlannerItemRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0);
  if (!Number.isInteger(item_id) || item_id <= 0) {
    return null;
  }

  return {
    item_id,
    file_path: String(candidate.file_path ?? ""),
    row_number: Number(candidate.row_number ?? candidate.row ?? 0),
    src: String(candidate.src ?? ""),
    dst: String(candidate.dst ?? ""),
    name_dst: candidate.name_dst ?? null,
    status: String(candidate.status ?? "NONE"),
    text_type: String(candidate.text_type ?? "NONE"),
    retry_count: Number(candidate.retry_count ?? 0),
  };
}

function clone_item_record(item: WorkbenchPlannerItemRecord): WorkbenchPlannerItemRecord {
  return {
    ...item,
  };
}

function build_file_map(state: ProjectStoreState): Map<string, WorkbenchPlannerFileRecord> {
  const file_map = new Map<string, WorkbenchPlannerFileRecord>();
  for (const value of Object.values(state.files)) {
    const file = normalize_file_record(value);
    if (file === null || file.rel_path === "") {
      continue;
    }
    file_map.set(file.rel_path, file);
  }
  return file_map;
}

function build_item_map(state: ProjectStoreState): Map<number, WorkbenchPlannerItemRecord> {
  const item_map = new Map<number, WorkbenchPlannerItemRecord>();
  for (const value of Object.values(state.items)) {
    const item = normalize_item_record(value);
    if (item === null) {
      continue;
    }
    item_map.set(item.item_id, item);
  }
  return item_map;
}

function build_file_section(
  file_map: Map<string, WorkbenchPlannerFileRecord>,
): Record<string, Record<string, unknown>> {
  const next_files: Record<string, Record<string, unknown>> = {};
  for (const file of file_map.values()) {
    next_files[file.rel_path] = {
      rel_path: file.rel_path,
      file_type: file.file_type,
      sort_index: file.sort_index,
    };
  }
  return next_files;
}

function build_item_section(
  item_map: Map<number, WorkbenchPlannerItemRecord>,
): Record<string, Record<string, unknown>> {
  const next_items: Record<string, Record<string, unknown>> = {};
  for (const item of item_map.values()) {
    next_items[String(item.item_id)] = {
      item_id: item.item_id,
      file_path: item.file_path,
      row_number: item.row_number,
      src: item.src,
      dst: item.dst,
      name_dst: item.name_dst ?? null,
      status: item.status,
      text_type: item.text_type,
      retry_count: item.retry_count,
    };
  }
  return next_items;
}

function normalize_target_rel_paths(rel_paths: string[]): string[] {
  const normalized_rel_paths: string[] = [];
  for (const rel_path of rel_paths) {
    const normalized_rel_path = String(rel_path).trim();
    if (normalized_rel_path === "" || normalized_rel_paths.includes(normalized_rel_path)) {
      continue;
    }
    normalized_rel_paths.push(normalized_rel_path);
  }
  if (normalized_rel_paths.length === 0) {
    throw new Error("工作台文件路径无效。");
  }
  return normalized_rel_paths;
}

function build_expected_revisions(
  state: ProjectStoreState,
  sections: Array<"files" | "items" | "analysis">,
): Record<string, number> {
  const expected_section_revisions: Record<string, number> = {};
  for (const section of sections) {
    expected_section_revisions[section] = state.revisions.sections[section] ?? 0;
  }
  return expected_section_revisions;
}

function build_derived_meta(args: {
  state: ProjectStoreState;
  files: Record<string, Record<string, unknown>>;
  items: Record<string, Record<string, unknown>>;
  settings: WorkbenchPlannerSettings;
}): {
  items: Record<string, Record<string, unknown>>;
  analysis: Record<string, unknown>;
  task_snapshot: Record<string, unknown>;
  derived_meta: WorkbenchDerivedMeta;
} {
  const mutation_output = compute_project_prefilter_mutation({
    state: {
      ...args.state,
      files: args.files,
      items: args.items,
    },
    source_language: args.settings.source_language,
    mtool_optimizer_enable: args.settings.mtool_optimizer_enable,
  });

  return {
    items: mutation_output.items,
    analysis: mutation_output.analysis,
    task_snapshot: mutation_output.task_snapshot,
    derived_meta: {
      translation_extras: mutation_output.translation_extras,
      project_status: mutation_output.project_status,
      prefilter_config: mutation_output.prefilter_config,
    },
  };
}

function serialize_workbench_item_payloads(
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return items.map((item) => {
    return {
      id: Number(item.item_id ?? item.id ?? 0),
      file_path: String(item.file_path ?? ""),
      row: Number(item.row_number ?? item.row ?? 0),
      src: String(item.src ?? ""),
      dst: String(item.dst ?? ""),
      name_dst: item.name_dst ?? null,
      status: String(item.status ?? "NONE"),
      text_type: String(item.text_type ?? "NONE"),
      retry_count: Number(item.retry_count ?? 0),
    };
  });
}

export function create_workbench_reorder_plan(args: {
  state: ProjectStoreState;
  ordered_rel_paths: string[];
}): WorkbenchProjectMutationPlan {
  const file_map = build_file_map(args.state);
  const ordered_rel_paths = normalize_target_rel_paths(args.ordered_rel_paths);
  if (ordered_rel_paths.length !== file_map.size) {
    throw new Error("工作台文件顺序无效。");
  }

  const next_file_map = new Map<string, WorkbenchPlannerFileRecord>();
  for (const [index, rel_path] of ordered_rel_paths.entries()) {
    const current_file = file_map.get(rel_path);
    if (current_file === undefined) {
      throw new Error("工作台文件顺序无效。");
    }

    next_file_map.set(rel_path, {
      ...current_file,
      sort_index: index,
    });
  }

  const next_files = build_file_section(next_file_map);
  return {
    updatedSections: ["files"],
    patch: [createProjectStoreReplaceSectionPatch("files", next_files)],
    requestBody: {
      ordered_rel_paths: ordered_rel_paths,
      expected_section_revisions: build_expected_revisions(args.state, ["files"]),
    },
  };
}

export function create_workbench_reset_file_plan(args: {
  state: ProjectStoreState;
  rel_path: string;
  settings: WorkbenchPlannerSettings;
}): WorkbenchProjectMutationPlan {
  const item_map = build_item_map(args.state);
  const target_rel_path = String(args.rel_path).trim();
  if (target_rel_path === "") {
    throw new Error("工作台文件路径无效。");
  }

  const target_items: WorkbenchPlannerItemRecord[] = [];
  for (const item of item_map.values()) {
    if (item.file_path !== target_rel_path) {
      continue;
    }

    item_map.set(item.item_id, {
      ...clone_item_record(item),
      dst: "",
      name_dst: null,
      status: "NONE",
      retry_count: 0,
    });
    target_items.push(item);
  }

  if (target_items.length === 0) {
    throw new Error("目标文件不存在。");
  }

  const next_items = build_item_section(item_map);
  const derived_state = build_derived_meta({
    state: args.state,
    files: args.state.files as Record<string, Record<string, unknown>>,
    items: next_items,
    settings: args.settings,
  });

  const changed_items = Object.values(derived_state.items)
    .filter((item) => String(item.file_path ?? "") === target_rel_path)
    .sort((left_item, right_item) => {
      return Number(left_item.item_id ?? 0) - Number(right_item.item_id ?? 0);
    });

  return {
    updatedSections: ["items", "analysis", "task"],
    patch: [
      {
        op: "merge_items",
        items: changed_items,
      },
      createProjectStoreReplaceSectionPatch("analysis", derived_state.analysis),
      createProjectStoreReplaceSectionPatch("task", derived_state.task_snapshot),
    ],
    requestBody: {
      rel_path: target_rel_path,
      items: serialize_workbench_item_payloads(changed_items),
      derived_meta: derived_state.derived_meta,
      expected_section_revisions: build_expected_revisions(args.state, ["items", "analysis"]),
    },
  };
}

export function create_workbench_delete_files_plan(args: {
  state: ProjectStoreState;
  rel_paths: string[];
  settings: WorkbenchPlannerSettings;
}): WorkbenchProjectMutationPlan {
  const target_rel_paths = normalize_target_rel_paths(args.rel_paths);
  const target_rel_path_set = new Set(target_rel_paths);
  const file_map = build_file_map(args.state);
  const item_map = build_item_map(args.state);

  let removed_file_count = 0;
  for (const rel_path of target_rel_paths) {
    if (file_map.delete(rel_path)) {
      removed_file_count += 1;
    }
  }
  if (removed_file_count === 0) {
    throw new Error("目标文件不存在。");
  }

  const next_item_map = new Map<number, WorkbenchPlannerItemRecord>();
  for (const item of item_map.values()) {
    if (target_rel_path_set.has(item.file_path)) {
      continue;
    }
    next_item_map.set(item.item_id, clone_item_record(item));
  }

  const next_files = build_file_section(file_map);
  const next_items = build_item_section(next_item_map);
  const derived_state = build_derived_meta({
    state: args.state,
    files: next_files,
    items: next_items,
    settings: args.settings,
  });

  return {
    updatedSections: ["files", "items", "analysis", "task"],
    patch: [
      createProjectStoreReplaceSectionPatch("files", next_files),
      createProjectStoreReplaceSectionPatch("items", derived_state.items),
      createProjectStoreReplaceSectionPatch("analysis", derived_state.analysis),
      createProjectStoreReplaceSectionPatch("task", derived_state.task_snapshot),
    ],
    requestBody: {
      rel_paths: target_rel_paths,
      derived_meta: derived_state.derived_meta,
      expected_section_revisions: build_expected_revisions(args.state, [
        "files",
        "items",
        "analysis",
      ]),
    },
  };
}

export type WorkbenchFileParsePreview = {
  source_path: string;
  target_rel_path: string;
  file_type: string;
  parsed_items: Array<Record<string, unknown>>;
};

type WorkbenchParsedItemRecord = {
  id: number | null;
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

const INHERITABLE_STATUSES = new Set(["PROCESSED"]);
const STRUCTURAL_STATUSES = new Set(["EXCLUDED", "RULE_SKIPPED", "LANGUAGE_SKIPPED", "DUPLICATED"]);

function normalize_casefold_path(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function build_next_item_id_seed(state: ProjectStoreState): number {
  let next_item_id_seed = 0;
  for (const value of Object.values(state.items)) {
    const item = normalize_item_record(value);
    if (item === null) {
      continue;
    }
    next_item_id_seed = Math.max(next_item_id_seed, item.item_id);
  }
  return next_item_id_seed;
}

function build_next_sort_index(file_map: Map<string, WorkbenchPlannerFileRecord>): number {
  let next_sort_index = -1;
  for (const file of file_map.values()) {
    next_sort_index = Math.max(next_sort_index, file.sort_index);
  }
  return next_sort_index + 1;
}

function normalize_parsed_item_record(
  value: Record<string, unknown>,
  target_rel_path: string,
): WorkbenchParsedItemRecord {
  const raw_id = value.id;
  const normalized_id =
    raw_id === undefined || raw_id === null || raw_id === "" ? null : Number(raw_id);

  return {
    id: Number.isInteger(normalized_id) ? normalized_id : null,
    src: String(value.src ?? ""),
    dst: String(value.dst ?? ""),
    name_src: value.name_src ?? null,
    name_dst: value.name_dst ?? null,
    extra_field: value.extra_field ?? "",
    tag: String(value.tag ?? ""),
    row: Number(value.row ?? value.row_number ?? 0),
    file_type: String(value.file_type ?? "NONE"),
    file_path: target_rel_path,
    text_type: String(value.text_type ?? "NONE"),
    status: String(value.status ?? "NONE"),
    retry_count: Number(value.retry_count ?? 0),
  };
}

function clone_parsed_item_record(item: WorkbenchParsedItemRecord): WorkbenchParsedItemRecord {
  return {
    ...item,
  };
}

function serialize_full_parsed_item_payloads(
  parsed_items: WorkbenchParsedItemRecord[],
): Array<Record<string, unknown>> {
  return parsed_items.map((item) => {
    return {
      id: item.id,
      src: item.src,
      dst: item.dst,
      name_src: item.name_src,
      name_dst: item.name_dst,
      extra_field: item.extra_field,
      tag: item.tag,
      row: item.row,
      file_type: item.file_type,
      file_path: item.file_path,
      text_type: item.text_type,
      status: item.status,
      retry_count: item.retry_count,
    };
  });
}

function convert_parsed_item_to_runtime_record(
  item: WorkbenchParsedItemRecord,
): WorkbenchPlannerItemRecord {
  if (!Number.isInteger(item.id) || item.id === null || item.id <= 0) {
    throw new Error("工作台条目缺少稳定 item_id。");
  }

  return {
    item_id: item.id,
    file_path: item.file_path,
    row_number: item.row,
    src: item.src,
    dst: item.dst,
    name_dst: item.name_dst,
    status: item.status,
    text_type: item.text_type,
    retry_count: item.retry_count,
  };
}

function assign_item_ids_for_add(args: {
  next_item_id_seed: number;
  parsed_items: WorkbenchParsedItemRecord[];
}): WorkbenchParsedItemRecord[] {
  let next_item_id = args.next_item_id_seed;
  return args.parsed_items.map((item) => {
    return {
      ...clone_parsed_item_record(item),
      id: next_item_id++,
    };
  });
}

function normalize_status_value(value: unknown): string {
  const normalized_value = String(value ?? "NONE").trim();
  return normalized_value === "" ? "NONE" : normalized_value;
}

type TranslationInheritanceCandidate = {
  dst: string;
  name_dst: unknown;
  retry_count: number;
  status: string;
  count: number;
  first_index: number;
};

function build_translation_inheritance_candidates(
  old_items: WorkbenchPlannerItemRecord[],
): Map<string, TranslationInheritanceCandidate[]> {
  const src_candidates = new Map<string, Map<string, TranslationInheritanceCandidate>>();
  let global_index = 0;

  for (const item of old_items) {
    const status = normalize_status_value(item.status);
    const dst = item.dst.trim();
    if (!INHERITABLE_STATUSES.has(status) || dst === "") {
      global_index += 1;
      continue;
    }

    const candidates_by_dst = src_candidates.get(item.src) ?? new Map();
    const existing_candidate = candidates_by_dst.get(item.dst);
    if (existing_candidate === undefined) {
      candidates_by_dst.set(item.dst, {
        dst: item.dst,
        name_dst: item.name_dst ?? null,
        retry_count: item.retry_count,
        status,
        count: 1,
        first_index: global_index,
      });
    } else {
      existing_candidate.count += 1;
    }
    src_candidates.set(item.src, candidates_by_dst);
    global_index += 1;
  }

  const candidate_map = new Map<string, TranslationInheritanceCandidate[]>();
  for (const [src, candidates_by_dst] of src_candidates.entries()) {
    candidate_map.set(
      src,
      [...candidates_by_dst.values()].sort((left_candidate, right_candidate) => {
        if (left_candidate.count !== right_candidate.count) {
          return right_candidate.count - left_candidate.count;
        }
        return left_candidate.first_index - right_candidate.first_index;
      }),
    );
  }
  return candidate_map;
}

function create_normalized_add_parsed_items(
  parsed_file: WorkbenchFileParsePreview,
): WorkbenchParsedItemRecord[] {
  return parsed_file.parsed_items.map((item) => {
    return normalize_parsed_item_record(item, parsed_file.target_rel_path);
  });
}

function inherit_completed_translations(args: {
  old_items: WorkbenchPlannerItemRecord[];
  next_items: WorkbenchParsedItemRecord[];
}): void {
  const candidate_map = build_translation_inheritance_candidates(args.old_items);

  for (const item of args.next_items) {
    const candidates = candidate_map.get(item.src);
    if (candidates === undefined || candidates.length === 0) {
      continue;
    }

    const candidate = candidates[0];

    item.dst = candidate.dst;
    item.name_dst = candidate.name_dst ?? null;
    item.retry_count = candidate.retry_count;
    if (!STRUCTURAL_STATUSES.has(normalize_status_value(item.status))) {
      item.status = candidate.status;
    }
  }
}

function ensure_target_path_not_conflict(args: {
  file_map: Map<string, WorkbenchPlannerFileRecord>;
  current_rel_path?: string | null;
  target_rel_path: string;
}): void {
  const target_key = normalize_casefold_path(args.target_rel_path);
  for (const existing_rel_path of args.file_map.keys()) {
    if (
      args.current_rel_path !== undefined &&
      args.current_rel_path !== null &&
      normalize_casefold_path(existing_rel_path) === normalize_casefold_path(args.current_rel_path)
    ) {
      continue;
    }

    if (normalize_casefold_path(existing_rel_path) === target_key) {
      throw new Error("目标文件名已存在。");
    }
  }
}

function create_file_mutation_runtime_plan(args: {
  state: ProjectStoreState;
  file_map: Map<string, WorkbenchPlannerFileRecord>;
  next_file_map: Map<string, WorkbenchPlannerFileRecord>;
  next_item_map: Map<number, WorkbenchPlannerItemRecord>;
  settings: WorkbenchPlannerSettings;
  request_body: Record<string, unknown>;
}): WorkbenchProjectMutationPlan {
  const next_files = build_file_section(args.next_file_map);
  const next_items = build_item_section(args.next_item_map);
  const derived_state = build_derived_meta({
    state: args.state,
    files: next_files,
    items: next_items,
    settings: args.settings,
  });

  return {
    updatedSections: ["files", "items", "analysis", "task"],
    patch: [
      createProjectStoreReplaceSectionPatch("files", next_files),
      createProjectStoreReplaceSectionPatch("items", derived_state.items),
      createProjectStoreReplaceSectionPatch("analysis", derived_state.analysis),
      createProjectStoreReplaceSectionPatch("task", derived_state.task_snapshot),
    ],
    requestBody: {
      ...args.request_body,
      derived_meta: derived_state.derived_meta,
      expected_section_revisions: build_expected_revisions(args.state, [
        "files",
        "items",
        "analysis",
      ]),
    },
  };
}

export function create_workbench_add_file_plan(args: {
  state: ProjectStoreState;
  parsed_file: WorkbenchFileParsePreview;
  settings: WorkbenchPlannerSettings;
  inheritance_mode?: WorkbenchTranslationInheritanceMode;
}): WorkbenchProjectMutationPlan {
  return create_workbench_add_files_plan({
    state: args.state,
    parsed_files: [args.parsed_file],
    settings: args.settings,
    inheritance_mode: args.inheritance_mode,
  });
}

export function create_workbench_add_files_plan(args: {
  state: ProjectStoreState;
  parsed_files: WorkbenchFileParsePreview[];
  settings: WorkbenchPlannerSettings;
  inheritance_mode?: WorkbenchTranslationInheritanceMode;
}): WorkbenchProjectMutationPlan {
  if (args.parsed_files.length === 0) {
    throw new Error("工作台文件路径无效。");
  }

  const file_map = build_file_map(args.state);
  const next_file_map = new Map(file_map);
  const next_item_map = build_item_map(args.state);
  const old_items = [...next_item_map.values()];
  const files_payload: Array<Record<string, unknown>> = [];
  const batch_target_path_set = new Set<string>();
  let next_item_id_seed = build_next_item_id_seed(args.state) + 1;
  let next_sort_index = build_next_sort_index(file_map);

  for (const parsed_file of args.parsed_files) {
    const target_rel_path = parsed_file.target_rel_path.trim();
    if (target_rel_path === "") {
      throw new Error("工作台文件路径无效。");
    }

    ensure_target_path_not_conflict({
      file_map,
      target_rel_path,
    });

    const target_key = normalize_casefold_path(target_rel_path);
    if (batch_target_path_set.has(target_key)) {
      throw new Error("目标文件名已存在。");
    }
    batch_target_path_set.add(target_key);

    const normalized_parsed_items = assign_item_ids_for_add({
      next_item_id_seed,
      parsed_items: create_normalized_add_parsed_items({
        ...parsed_file,
        target_rel_path,
      }),
    });
    next_item_id_seed += normalized_parsed_items.length;
    if (args.inheritance_mode === "inherit") {
      inherit_completed_translations({
        old_items,
        next_items: normalized_parsed_items,
      });
    }

    for (const item of normalized_parsed_items) {
      const runtime_item = convert_parsed_item_to_runtime_record(item);
      next_item_map.set(runtime_item.item_id, runtime_item);
    }

    next_file_map.set(target_rel_path, {
      rel_path: target_rel_path,
      file_type: parsed_file.file_type,
      sort_index: next_sort_index,
    });

    files_payload.push({
      source_path: parsed_file.source_path,
      target_rel_path,
      file_record: {
        rel_path: target_rel_path,
        file_type: parsed_file.file_type,
        sort_index: next_sort_index,
      },
      parsed_items: serialize_full_parsed_item_payloads(normalized_parsed_items),
    });
    next_sort_index += 1;
  }

  return create_file_mutation_runtime_plan({
    state: args.state,
    file_map,
    next_file_map,
    next_item_map,
    settings: args.settings,
    request_body: {
      files: files_payload,
    },
  });
}
