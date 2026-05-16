import { compute_project_prefilter_mutation } from "@/project/prefilter/prefilter-mutation-builder";
import {
  createProjectStoreFilesDeltaChange,
  createProjectStoreItemsDeltaChange,
  createProjectStoreReplaceSectionChange,
  type ProjectStoreChangeOperation,
  type ProjectStoreState,
} from "@/project/store/project-store";
import { create_empty_translation_task_snapshot } from "@/project/reset/reset-state-builders";
import {
  Item,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "@base/item";

type WorkbenchPlannerSettings = {
  source_language: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
};

type WorkbenchPlannerTaskSnapshot = Record<string, unknown>;

type WorkbenchPlannerFileRecord = {
  rel_path: string;
  file_type: string;
  sort_index: number;
};

type WorkbenchPlannerItemRecord = ProjectItemPublicRecord;

type WorkbenchTranslationInheritanceMode = "none" | "inherit";

/**
 * 工作台 mutation 派生出的任务 meta 直接进入请求顶层，不再包旧 derived_meta
 */
type WorkbenchMutationMeta = {
  translation_extras: Record<string, unknown>;
  prefilter_config: {
    source_language: string;
    mtool_optimizer_enable: boolean;
    skip_duplicate_source_text_enable: boolean;
  };
};

/**
 * planner 同时产出本地 ProjectStore 操作、后端请求和任务快照，保证三者同源
 */
export type WorkbenchProjectMutationPlan = {
  updatedSections: Array<"files" | "items" | "analysis">;
  operations: ProjectStoreChangeOperation[];
  requestBody: Record<string, unknown>;
  next_task_snapshot?: Record<string, unknown>;
};

type WorkbenchMutationRuntimeState = {
  items: Record<string, ProjectItemPublicRecord>;
  analysis: Record<string, unknown>;
  task_snapshot: Record<string, unknown>;
  mutation_meta: WorkbenchMutationMeta;
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

// 工作台 item 来源必须是完整公开 DTO，文件 mutation 才能保留扩展字段
function normalize_item_record(value: unknown): WorkbenchPlannerItemRecord | null {
  return normalize_project_item_public_record(value);
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

// 文件 mutation 会重建 item section，先用完整 DTO 建索引避免丢字段
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

// 工作台本地替换 section 时写入完整公开 DTO，防止丢失文件格式和扩展字段
function build_item_section(
  item_map: Map<number, WorkbenchPlannerItemRecord>,
): Record<string, ProjectItemPublicRecord> {
  const next_items: Record<string, ProjectItemPublicRecord> = {};
  for (const item of item_map.values()) {
    next_items[String(item.item_id)] = {
      item_id: item.item_id,
      file_path: item.file_path,
      row_number: item.row_number,
      src: item.src,
      dst: item.dst,
      name_src: item.name_src,
      name_dst: item.name_dst ?? null,
      extra_field: item.extra_field,
      tag: item.tag,
      file_type: item.file_type,
      status: item.status,
      text_type: item.text_type,
      retry_count: item.retry_count,
      skip_internal_filter: item.skip_internal_filter,
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

/**
 * 文件集合 mutation 会重算 items、analysis 和任务进度，避免页面只改局部事实
 */
function build_workbench_mutation_state(args: {
  state: ProjectStoreState;
  task_snapshot?: WorkbenchPlannerTaskSnapshot;
  files: Record<string, Record<string, unknown>>;
  items: Record<string, ProjectItemPublicRecord>;
  settings: WorkbenchPlannerSettings;
}): WorkbenchMutationRuntimeState {
  const base_task_snapshot = args.task_snapshot ?? create_empty_translation_task_snapshot();
  const mutation_output = compute_project_prefilter_mutation({
    state: {
      ...args.state,
      files: args.files,
      items: args.items,
    },
    task_snapshot: base_task_snapshot,
    source_language: args.settings.source_language,
    mtool_optimizer_enable: args.settings.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: args.settings.skip_duplicate_source_text_enable,
  });

  return {
    items: mutation_output.items,
    analysis: mutation_output.analysis,
    task_snapshot: mutation_output.task_snapshot,
    mutation_meta: {
      translation_extras: mutation_output.translation_extras,
      prefilter_config: mutation_output.prefilter_config,
    },
  };
}

// reset-file 后端请求只表达局部 patch，完整 DTO 只用于本地 store 回流
function serialize_workbench_item_patch_payloads(
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

// add-file payload 以最终运行态覆盖解析草稿，同时保留解析器提供的展示辅助字段
function serialize_add_file_payload_items(args: {
  parsed_items: WorkbenchParsedItemRecord[];
  final_items: Record<string, Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  return args.parsed_items.map((parsed_item) => {
    const final_item = args.final_items[String(parsed_item.id)] ?? {};
    return {
      id: parsed_item.id,
      src: String(final_item.src ?? parsed_item.src),
      dst: String(final_item.dst ?? parsed_item.dst),
      name_src: parsed_item.name_src,
      name_dst: final_item.name_dst ?? parsed_item.name_dst ?? null,
      extra_field: parsed_item.extra_field,
      tag: parsed_item.tag,
      row: Number(final_item.row_number ?? final_item.row ?? parsed_item.row),
      file_type: parsed_item.file_type,
      file_path: String(final_item.file_path ?? parsed_item.file_path),
      text_type: String(final_item.text_type ?? parsed_item.text_type),
      status: String(final_item.status ?? parsed_item.status),
      retry_count: Number(final_item.retry_count ?? parsed_item.retry_count),
      skip_internal_filter:
        final_item.skip_internal_filter === true || parsed_item.skip_internal_filter,
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
    operations: [createProjectStoreReplaceSectionChange("files", next_files)],
    requestBody: {
      ordered_rel_paths: ordered_rel_paths,
      expected_section_revisions: build_expected_revisions(args.state, ["files"]),
    },
  };
}

export function create_workbench_reset_file_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: WorkbenchPlannerTaskSnapshot;
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
  const mutation_state = build_workbench_mutation_state({
    state: args.state,
    task_snapshot: args.task_snapshot,
    files: args.state.files as Record<string, Record<string, unknown>>,
    items: next_items,
    settings: args.settings,
  });

  const changed_items = Object.values(mutation_state.items)
    .filter((item) => String(item.file_path ?? "") === target_rel_path)
    .sort((left_item, right_item) => {
      return Number(left_item.item_id ?? 0) - Number(right_item.item_id ?? 0);
    });

  return {
    updatedSections: ["items", "analysis"],
    operations: [
      createProjectStoreItemsDeltaChange({ upsertItems: changed_items }),
      createProjectStoreReplaceSectionChange("analysis", mutation_state.analysis),
    ],
    requestBody: {
      rel_paths: [target_rel_path],
      items: serialize_workbench_item_patch_payloads(changed_items),
      translation_extras: mutation_state.mutation_meta.translation_extras,
      prefilter_config: mutation_state.mutation_meta.prefilter_config,
      expected_section_revisions: build_expected_revisions(args.state, ["items", "analysis"]),
    },
    next_task_snapshot: mutation_state.task_snapshot,
  };
}

export function create_workbench_delete_files_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: WorkbenchPlannerTaskSnapshot;
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
  const deleted_item_ids = [...item_map.values()]
    .filter((item) => target_rel_path_set.has(item.file_path))
    .map((item) => item.item_id);
  const next_items = build_item_section(next_item_map);
  const mutation_state = build_workbench_mutation_state({
    state: args.state,
    task_snapshot: args.task_snapshot,
    files: next_files,
    items: next_items,
    settings: args.settings,
  });

  return {
    updatedSections: ["files", "items", "analysis"],
    operations: [
      createProjectStoreFilesDeltaChange({ deletePaths: target_rel_paths }),
      createProjectStoreItemsDeltaChange({ deleteIds: deleted_item_ids }),
      createProjectStoreReplaceSectionChange("analysis", mutation_state.analysis),
    ],
    requestBody: {
      rel_paths: target_rel_paths,
      translation_extras: mutation_state.mutation_meta.translation_extras,
      prefilter_config: mutation_state.mutation_meta.prefilter_config,
      expected_section_revisions: build_expected_revisions(args.state, [
        "files",
        "items",
        "analysis",
      ]),
    },
    next_task_snapshot: mutation_state.task_snapshot,
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
  skip_internal_filter: boolean;
};

type WorkbenchAddFilePayloadDraft = {
  source_path: string;
  target_rel_path: string;
  file_record: WorkbenchPlannerFileRecord;
  parsed_items: WorkbenchParsedItemRecord[];
};

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
    skip_internal_filter: value.skip_internal_filter === true,
  };
}

function clone_parsed_item_record(item: WorkbenchParsedItemRecord): WorkbenchParsedItemRecord {
  return {
    ...item,
  };
}

// 新增文件解析结果必须立刻升格为完整公开 DTO，后续继承与本地 upsert 共用同一事实形状
function convert_parsed_item_to_runtime_record(
  item: WorkbenchParsedItemRecord,
): WorkbenchPlannerItemRecord {
  if (!Number.isInteger(item.id) || item.id === null || item.id <= 0) {
    throw new Error("工作台条目缺少稳定 item_id。");
  }

  const public_item = normalize_project_item_public_record({
    item_id: item.id,
    file_path: item.file_path,
    row_number: item.row,
    src: item.src,
    dst: item.dst,
    name_src: item.name_src,
    name_dst: item.name_dst,
    extra_field: item.extra_field,
    tag: item.tag,
    file_type: item.file_type,
    status: item.status,
    text_type: item.text_type,
    retry_count: item.retry_count,
    skip_internal_filter: item.skip_internal_filter,
  });
  if (public_item === null) {
    throw new Error("工作台条目必须生成完整公开 item DTO。");
  }
  return public_item;
}

// add-file 的 item id 在 planner 内一次性分配，避免继承阶段处理无主条目
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

// 继承旧译文时状态仍走 item 统一值域，防止 DONE 等旧值流回公开 DTO
function normalize_status_value(value: unknown): ProjectItemPublicRecord["status"] {
  return Item.normalize_status(value);
}

type TranslationInheritanceCandidate = {
  dst: string;
  name_dst: ProjectItemPublicRecord["name_dst"];
  retry_count: number;
  status: ProjectItemPublicRecord["status"];
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
    if (status !== "PROCESSED" || dst === "") {
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
  next_items: WorkbenchPlannerItemRecord[];
}): void {
  const candidate_map = build_translation_inheritance_candidates(args.old_items);

  for (const item of args.next_items) {
    if (normalize_status_value(item.status) !== "NONE") {
      continue;
    }

    const candidates = candidate_map.get(String(item.src ?? ""));
    if (candidates === undefined || candidates.length === 0) {
      continue;
    }

    const candidate = candidates[0];

    item.dst = candidate.dst;
    item.name_dst = candidate.name_dst ?? null;
    item.retry_count = candidate.retry_count;
    item.status = candidate.status;
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

function create_file_mutation_runtime_plan_from_state(args: {
  state: ProjectStoreState;
  next_files: Record<string, Record<string, unknown>>;
  mutation_state: WorkbenchMutationRuntimeState;
  request_body: Record<string, unknown>;
}): WorkbenchProjectMutationPlan {
  return {
    updatedSections: ["files", "items", "analysis"],
    operations: [
      createProjectStoreReplaceSectionChange("files", args.next_files),
      createProjectStoreReplaceSectionChange("items", args.mutation_state.items),
      createProjectStoreReplaceSectionChange("analysis", args.mutation_state.analysis),
    ],
    requestBody: {
      ...args.request_body,
      translation_extras: args.mutation_state.mutation_meta.translation_extras,
      prefilter_config: args.mutation_state.mutation_meta.prefilter_config,
      expected_section_revisions: build_expected_revisions(args.state, [
        "files",
        "items",
        "analysis",
      ]),
    },
    next_task_snapshot: args.mutation_state.task_snapshot,
  };
}

export function create_workbench_add_files_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: WorkbenchPlannerTaskSnapshot;
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
  const add_file_payload_drafts: WorkbenchAddFilePayloadDraft[] = [];
  const added_item_ids: number[] = [];
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

    for (const item of normalized_parsed_items) {
      const runtime_item = convert_parsed_item_to_runtime_record(item);
      next_item_map.set(runtime_item.item_id, runtime_item);
      added_item_ids.push(runtime_item.item_id);
    }

    const file_record = {
      rel_path: target_rel_path,
      file_type: parsed_file.file_type,
      sort_index: next_sort_index,
    };
    next_file_map.set(target_rel_path, file_record);

    add_file_payload_drafts.push({
      source_path: parsed_file.source_path,
      target_rel_path,
      file_record,
      parsed_items: normalized_parsed_items,
    });
    next_sort_index += 1;
  }

  const next_files = build_file_section(next_file_map);
  const next_items = build_item_section(next_item_map);
  let mutation_state = build_workbench_mutation_state({
    state: args.state,
    task_snapshot: args.task_snapshot,
    files: next_files,
    items: next_items,
    settings: args.settings,
  });

  if (args.inheritance_mode === "inherit") {
    // 继承必须发生在预过滤之后，只让仍待处理的新增条目吸收旧译文
    const inherited_items: Record<string, ProjectItemPublicRecord> = Object.fromEntries(
      Object.entries(mutation_state.items).map(([item_id, item]) => {
        return [item_id, { ...item }];
      }),
    ) as Record<string, ProjectItemPublicRecord>;
    inherit_completed_translations({
      old_items,
      next_items: added_item_ids.flatMap((item_id) => {
        const item = inherited_items[String(item_id)];
        return item === undefined ? [] : [item];
      }),
    });
    mutation_state = build_workbench_mutation_state({
      state: args.state,
      task_snapshot: args.task_snapshot,
      files: next_files,
      items: inherited_items,
      settings: args.settings,
    });
  }

  const files_payload = add_file_payload_drafts.map((draft) => {
    return {
      source_path: draft.source_path,
      target_rel_path: draft.target_rel_path,
      file_record: draft.file_record,
      parsed_items: serialize_add_file_payload_items({
        parsed_items: draft.parsed_items,
        final_items: mutation_state.items,
      }),
    };
  });

  return create_file_mutation_runtime_plan_from_state({
    state: args.state,
    next_files,
    mutation_state,
    request_body: {
      files: files_payload,
    },
  });
}
