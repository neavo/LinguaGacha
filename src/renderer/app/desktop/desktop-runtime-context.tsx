import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { RouteId } from "@/app/navigation/types";
import { api_fetch, open_event_stream } from "@/app/desktop/desktop-api";
import {
  createProjectStoreReplaceSectionChange,
  createProjectStore,
  isProjectStoreStage,
  type ProjectStoreChangeEvent,
  type ProjectStoreChangeOperation,
  type ProjectStoreChangeRevisionMode,
  type ProjectStoreSectionStateMap,
  type ProjectStoreStage,
  type ProjectStoreState,
  type ProjectStoreSectionRevisions,
  snapshotProjectStoreSections,
} from "@/project/store/project-store";
import {
  createTaskRuntimeStore,
  normalize_task_snapshot,
  type TaskSnapshot,
} from "@/app/desktop/task-runtime-store";
import {
  DesktopRuntimeRefreshScheduler,
  type DesktopRuntimeProjectItemsReadRequest,
} from "@/app/desktop/desktop-runtime-refresh-scheduler";
import {
  normalize_section_array,
  normalize_section_revisions,
  parse_event_payload,
} from "@/app/desktop/desktop-runtime-event-payload";
import {
  normalize_app_language,
  normalize_project_save_mode,
  type AppLanguage,
  type ProjectSaveMode,
} from "@base/setting";
import {
  PROJECT_CHANGE_EVENT_TOPIC,
  PROJECT_DATA_SECTIONS,
  normalizeProjectChangePayloadMode,
  type ProjectChangePayloadMode,
  type ProjectChangeJsonRecord,
} from "@shared/project/event";

type RecentProjectEntry = {
  path: string;
  name: string;
};

export type SettingsSnapshot = {
  app_language: AppLanguage;
  source_language: string;
  target_language: string;
  project_save_mode: ProjectSaveMode;
  project_fixed_path: string;
  output_folder_open_on_finish: boolean;
  request_timeout: number;
  preceding_lines_threshold: number;
  clean_ruby: boolean;
  deduplication_in_bilingual: boolean;
  check_kana_residue: boolean;
  check_hangeul_residue: boolean;
  check_similarity: boolean;
  write_translated_name_fields_to_file: boolean;
  auto_process_prefix_suffix_preserved_text: boolean;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
  glossary_default_preset: string;
  pre_translation_replacement_default_preset: string;
  post_translation_replacement_default_preset: string;
  text_preserve_default_preset: string;
  translation_custom_prompt_default_preset: string;
  analysis_custom_prompt_default_preset: string;
  recent_projects: RecentProjectEntry[];
};

export type ProjectSnapshot = {
  path: string;
  loaded: boolean;
};

type ProofreadingChangeMode = "full" | "delta" | "noop";
type WorkbenchChangeScope = "global" | "file";

type ProofreadingChangeSignal = {
  seq: number;
  reason: string;
  mode: ProofreadingChangeMode;
  updated_sections: ProjectStoreStage[];
  item_ids: Array<number | string>;
};

type ProofreadingChangeSignalInput = Omit<ProofreadingChangeSignal, "seq">;

type WorkbenchChangeSignal = {
  seq: number;
  reason: string;
  scope: WorkbenchChangeScope;
  mode: "full" | "items_delta";
  updated_sections: ProjectStoreStage[];
  item_ids: Array<number | string>;
};

type WorkbenchChangeSignalInput = Omit<WorkbenchChangeSignal, "seq">;

const WORKBENCH_REFRESH_SECTIONS = ["project", "files", "items", "analysis"];

type ProjectWarmupStatus = "idle" | "warming" | "ready";

type DesktopRuntimeContextValue = {
  hydration_ready: boolean;
  hydration_error: string | null;
  settings_snapshot: SettingsSnapshot;
  project_snapshot: ProjectSnapshot;
  task_snapshot: TaskSnapshot;
  proofreading_change_signal: ProofreadingChangeSignal;
  workbench_change_signal: WorkbenchChangeSignal;
  project_warmup_status: ProjectWarmupStatus;
  project_warmup_stage: ProjectStoreStage | null;
  pending_target_route: RouteId | null;
  is_app_language_updating: boolean;
  set_settings_snapshot: (snapshot: SettingsSnapshot) => void;
  set_project_snapshot: (snapshot: ProjectSnapshot) => void;
  set_task_snapshot: (snapshot: TaskSnapshot) => void;
  set_project_warmup_status: (status: ProjectWarmupStatus) => void;
  set_pending_target_route: (route_id: RouteId | null) => void;
  project_store: ReturnType<typeof createProjectStore>;
  commit_local_project_change: (input: LocalProjectChangeInput) => LocalProjectChangeCommit;
  refresh_project_runtime: () => Promise<void>;
  align_project_runtime_ack: (ack: ProjectMutationAck) => void;
  update_app_language: (language: AppLanguage) => Promise<SettingsSnapshot>;
  refresh_settings: () => Promise<SettingsSnapshot>;
  refresh_task: () => Promise<TaskSnapshot>;
};

export type SettingsSnapshotPayload = {
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>;
  };
};

type ProjectSnapshotPayload = {
  project?: Partial<ProjectSnapshot>;
};

type TaskSnapshotPayload = {
  task?: Partial<TaskSnapshot>;
};

type SettingsChangedEventPayload = {
  keys?: unknown;
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>;
  };
};

type ProjectChangeEventPayload = {
  source?: unknown;
  projectRevision?: unknown;
  updatedSections?: unknown;
  items?: unknown;
  files?: unknown;
  sections?: unknown;
  sectionRevisions?: unknown;
};

type ProjectManifestPayload = {
  project?: Partial<ProjectSnapshot>;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
};

type ProjectReadSectionsPayload = {
  sections?: unknown;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
};

type ProjectReadItemsByIdsPayload = {
  items?: unknown;
  missingIds?: unknown;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
  itemRevision?: unknown;
};

export type ProjectMutationAckPayload = {
  accepted?: unknown;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
};

export type ProjectMutationAck = {
  accepted: boolean;
  projectRevision: number;
  sectionRevisions: ProjectStoreSectionRevisions;
};

/**
 * 本地乐观变更只描述 ProjectStore 操作，不承载后端 mutation 请求体
 */
export type LocalProjectChangeInput = {
  source: string;
  updatedSections: ProjectStoreStage[];
  operations: ProjectStoreChangeOperation[];
  rollbackOperations?: ProjectStoreChangeOperation[];
};

/**
 * 提交结果保留回滚所需的旧 revision 和旧 section，避免页面自行读取 store 历史
 */
export type LocalProjectChangeCommit = {
  previousProjectRevision: number;
  previousSectionRevisions: ProjectStoreSectionRevisions;
  previousSections: Partial<ProjectStoreSectionStateMap>;
  rollback: (source?: string) => void;
};

const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  app_language: "ZH",
  source_language: "JA",
  target_language: "ZH",
  project_save_mode: "MANUAL",
  project_fixed_path: "",
  output_folder_open_on_finish: true,
  request_timeout: 60,
  preceding_lines_threshold: 0,
  clean_ruby: false,
  deduplication_in_bilingual: true,
  check_kana_residue: true,
  check_hangeul_residue: true,
  check_similarity: true,
  write_translated_name_fields_to_file: true,
  auto_process_prefix_suffix_preserved_text: true,
  mtool_optimizer_enable: true,
  skip_duplicate_source_text_enable: true,
  glossary_default_preset: "",
  pre_translation_replacement_default_preset: "",
  post_translation_replacement_default_preset: "",
  text_preserve_default_preset: "",
  translation_custom_prompt_default_preset: "",
  analysis_custom_prompt_default_preset: "",
  recent_projects: [],
};

const DEFAULT_PROJECT_SNAPSHOT: ProjectSnapshot = {
  path: "",
  loaded: false,
};

const DEFAULT_PROOFREADING_CHANGE_SIGNAL: ProofreadingChangeSignal = {
  seq: 0,
  reason: "",
  mode: "full",
  updated_sections: [],
  item_ids: [],
};

const DEFAULT_WORKBENCH_CHANGE_SIGNAL: WorkbenchChangeSignal = {
  seq: 0,
  reason: "",
  scope: "global",
  mode: "full",
  updated_sections: [],
  item_ids: [],
};

export const DesktopRuntimeContext = createContext<DesktopRuntimeContextValue | null>(null);

function normalize_recent_projects(
  recent_projects: Array<Partial<RecentProjectEntry>> | undefined,
): RecentProjectEntry[] {
  if (!Array.isArray(recent_projects)) {
    return [];
  }

  return recent_projects
    .filter((entry) => typeof entry?.path === "string" && entry.path !== "")
    .map((entry) => ({
      path: String(entry.path),
      name: String(entry.name ?? ""),
    }));
}

export function normalize_settings_snapshot(payload: SettingsSnapshotPayload): SettingsSnapshot {
  const snapshot = payload.settings ?? {};
  return {
    app_language: normalize_app_language(snapshot.app_language),
    source_language: String(snapshot.source_language ?? DEFAULT_SETTINGS_SNAPSHOT.source_language),
    target_language: String(snapshot.target_language ?? DEFAULT_SETTINGS_SNAPSHOT.target_language),
    project_save_mode: normalize_project_save_mode(snapshot.project_save_mode),
    project_fixed_path: String(snapshot.project_fixed_path ?? ""),
    output_folder_open_on_finish: Boolean(
      snapshot.output_folder_open_on_finish ??
      DEFAULT_SETTINGS_SNAPSHOT.output_folder_open_on_finish,
    ),
    request_timeout: Number(snapshot.request_timeout ?? DEFAULT_SETTINGS_SNAPSHOT.request_timeout),
    preceding_lines_threshold: Number(
      snapshot.preceding_lines_threshold ?? DEFAULT_SETTINGS_SNAPSHOT.preceding_lines_threshold,
    ),
    clean_ruby: Boolean(snapshot.clean_ruby ?? DEFAULT_SETTINGS_SNAPSHOT.clean_ruby),
    deduplication_in_bilingual: Boolean(
      snapshot.deduplication_in_bilingual ?? DEFAULT_SETTINGS_SNAPSHOT.deduplication_in_bilingual,
    ),
    check_kana_residue: Boolean(
      snapshot.check_kana_residue ?? DEFAULT_SETTINGS_SNAPSHOT.check_kana_residue,
    ),
    check_hangeul_residue: Boolean(
      snapshot.check_hangeul_residue ?? DEFAULT_SETTINGS_SNAPSHOT.check_hangeul_residue,
    ),
    check_similarity: Boolean(
      snapshot.check_similarity ?? DEFAULT_SETTINGS_SNAPSHOT.check_similarity,
    ),
    write_translated_name_fields_to_file: Boolean(
      snapshot.write_translated_name_fields_to_file ??
      DEFAULT_SETTINGS_SNAPSHOT.write_translated_name_fields_to_file,
    ),
    auto_process_prefix_suffix_preserved_text: Boolean(
      snapshot.auto_process_prefix_suffix_preserved_text ??
      DEFAULT_SETTINGS_SNAPSHOT.auto_process_prefix_suffix_preserved_text,
    ),
    mtool_optimizer_enable: Boolean(
      snapshot.mtool_optimizer_enable ?? DEFAULT_SETTINGS_SNAPSHOT.mtool_optimizer_enable,
    ),
    skip_duplicate_source_text_enable: Boolean(
      snapshot.skip_duplicate_source_text_enable ??
      DEFAULT_SETTINGS_SNAPSHOT.skip_duplicate_source_text_enable,
    ),
    glossary_default_preset: String(snapshot.glossary_default_preset ?? ""),
    pre_translation_replacement_default_preset: String(
      snapshot.pre_translation_replacement_default_preset ?? "",
    ),
    post_translation_replacement_default_preset: String(
      snapshot.post_translation_replacement_default_preset ?? "",
    ),
    text_preserve_default_preset: String(snapshot.text_preserve_default_preset ?? ""),
    translation_custom_prompt_default_preset: String(
      snapshot.translation_custom_prompt_default_preset ?? "",
    ),
    analysis_custom_prompt_default_preset: String(
      snapshot.analysis_custom_prompt_default_preset ?? "",
    ),
    recent_projects: normalize_recent_projects(snapshot.recent_projects),
  };
}

function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  const snapshot = payload.project ?? {};
  return {
    path: String(snapshot.path ?? ""),
    loaded: Boolean(snapshot.loaded),
  };
}

export function normalize_project_mutation_ack(
  payload: ProjectMutationAckPayload,
): ProjectMutationAck {
  return {
    accepted: payload.accepted === undefined ? true : Boolean(payload.accepted),
    projectRevision: Number(payload.projectRevision ?? 0),
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions) ?? {},
  };
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize_record_map(value: unknown): Record<string, ProjectChangeJsonRecord> {
  if (!is_record(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, Record<string, unknown>] => is_record(entry[1]))
      .map(([key, record]) => [key, { ...record } as ProjectChangeJsonRecord]),
  );
}

function normalize_number_array(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((item) => Number(item))
        .filter((item): item is number => Number.isInteger(item) && item > 0),
    ),
  ];
}

function normalize_string_array(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter((item) => item !== ""))];
}

function normalize_project_change_event(
  payload: ProjectChangeEventPayload,
): ProjectStoreChangeEvent | null {
  const updated_sections = normalize_section_array(payload.updatedSections).filter(
    isProjectStoreStage,
  );
  if (updated_sections.length === 0) {
    return null;
  }

  const items = is_record(payload.items)
    ? {
        payloadMode: normalizeProjectChangePayloadMode(payload.items.payloadMode),
        upsert: normalize_record_map(payload.items.upsert),
        changedIds: normalize_number_array(payload.items.changedIds),
        deleteIds: normalize_number_array(payload.items.deleteIds),
      }
    : undefined;
  const files = is_record(payload.files)
    ? {
        payloadMode: normalizeProjectChangePayloadMode(payload.files.payloadMode),
        upsert: normalize_record_map(payload.files.upsert),
        changedPaths: normalize_string_array(payload.files.changedPaths),
        deletePaths: normalize_string_array(payload.files.deletePaths),
      }
    : undefined;
  const sections = is_record(payload.sections)
    ? Object.fromEntries(
        Object.entries(payload.sections).flatMap(([section, raw_payload]) => {
          if (!isProjectStoreStage(section) || !is_record(raw_payload)) {
            return [];
          }
          const payload_mode: ProjectChangePayloadMode = normalizeProjectChangePayloadMode(
            raw_payload.payloadMode,
          );
          return [[section, { payloadMode: payload_mode, data: raw_payload.data }]];
        }),
      )
    : {};

  return {
    source: String(payload.source ?? "project_change"),
    projectRevision: Number(payload.projectRevision ?? 0),
    updatedSections: updated_sections,
    operations: [
      {
        ...(items === undefined ? {} : { items }),
        ...(files === undefined ? {} : { files }),
        sections,
      },
    ],
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions),
  };
}

function normalize_project_read_sections_event(
  payload: ProjectReadSectionsPayload,
): ProjectStoreChangeEvent | null {
  const raw_sections = is_record(payload.sections) ? payload.sections : {};
  const sections = Object.fromEntries(
    Object.entries(raw_sections).flatMap(([section, data]) => {
      if (!isProjectStoreStage(section)) {
        return [];
      }
      return [[section, { payloadMode: "canonical-delta", data }]];
    }),
  );
  const updated_sections = Object.keys(sections).filter(isProjectStoreStage);
  if (updated_sections.length === 0) {
    return null;
  }

  return {
    source: "project_read_sections",
    projectRevision: Number(payload.projectRevision ?? 0),
    updatedSections: updated_sections,
    operations: [{ sections }],
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions),
  };
}

// ids-only 补读结果只替换对应 item 行，并用 missingIds 表达 tombstone
function normalize_project_read_items_by_ids_event(args: {
  source: string;
  projectRevision: number;
  itemIds: number[];
  payload: ProjectReadItemsByIdsPayload;
}): ProjectStoreChangeEvent | null {
  const upsert = normalize_record_map(args.payload.items);
  const delete_ids = normalize_number_array(args.payload.missingIds);
  if (Object.keys(upsert).length === 0 && delete_ids.length === 0) {
    return null;
  }

  return {
    source: args.source,
    projectRevision: Number(args.payload.projectRevision ?? args.projectRevision),
    updatedSections: ["items"],
    operations: [
      {
        items: {
          payloadMode: "canonical-delta",
          upsert,
          changedIds: args.itemIds,
          deleteIds: delete_ids,
        },
      },
    ],
    sectionRevisions: normalize_section_revisions(args.payload.sectionRevisions) ?? {
      items: Number(args.payload.itemRevision ?? args.projectRevision),
    },
  };
}

// item id 在事件里可能来自 upsert key 或 changedIds，进入页面信号前统一成数字
function normalize_project_change_item_id(value: number | string): number | null {
  const item_id = Number(value);
  return Number.isInteger(item_id) && item_id > 0 ? item_id : null;
}

// 页面级 delta 信号只需要稳定去重后的 item id 列表
function collect_project_change_item_ids(event: ProjectStoreChangeEvent): number[] {
  const item_ids: number[] = [];

  for (const operation of event.operations) {
    for (const raw_item_id of [
      ...Object.keys(operation.items?.upsert ?? {}),
      ...(operation.items?.changedIds ?? []),
      ...(operation.items?.deleteIds ?? []),
    ]) {
      const item_id = normalize_project_change_item_id(raw_item_id);
      if (item_id !== null) {
        item_ids.push(item_id);
      }
    }
  }

  return [...new Set(item_ids)];
}

// ids-only 只给 item id，renderer 必须按 id 补读公开行后再写 ProjectStore
function collect_project_change_ids_only_item_ids(event: ProjectStoreChangeEvent): number[] {
  const item_ids: number[] = [];
  for (const operation of event.operations) {
    if (operation.items?.payloadMode !== "ids-only") {
      continue;
    }
    for (const raw_item_id of operation.items.changedIds ?? []) {
      const item_id = normalize_project_change_item_id(raw_item_id);
      if (item_id !== null) {
        item_ids.push(item_id);
      }
    }
  }
  return [...new Set(item_ids)];
}

function project_change_event_has_full_section(
  event: ProjectStoreChangeEvent,
  sections: ProjectStoreStage[],
): boolean {
  return event.operations.some((operation) =>
    sections.some((section) => operation.sections?.[section] !== undefined),
  );
}

function resolve_proofreading_change_signal(args: {
  reason: string;
  updated_sections: ProjectStoreStage[];
  change_event: ProjectStoreChangeEvent | null;
}): ProofreadingChangeSignalInput | null {
  const updated_sections = args.updated_sections;
  if (updated_sections.length === 0) {
    return null;
  }

  const has_full_input_section = updated_sections.some((section) =>
    ["project", "items", "quality"].includes(section),
  );
  const has_proofreading_only_section = updated_sections.some(
    (section) => section === "proofreading",
  );
  if (args.change_event === null) {
    if (has_full_input_section) {
      return {
        reason: args.reason,
        mode: "full",
        updated_sections,
        item_ids: [],
      };
    }

    if (has_proofreading_only_section) {
      return {
        reason: args.reason,
        mode: "noop",
        updated_sections,
        item_ids: [],
      };
    }

    return null;
  }

  const change_event = args.change_event;
  if (
    updated_sections.includes("project") ||
    updated_sections.includes("quality") ||
    project_change_event_has_full_section(change_event, ["project", "quality", "items"])
  ) {
    return {
      reason: args.reason,
      mode: "full",
      updated_sections,
      item_ids: [],
    };
  }

  if (updated_sections.every((section) => section === "proofreading")) {
    return {
      reason: args.reason,
      mode: "noop",
      updated_sections,
      item_ids: [],
    };
  }

  const item_ids = collect_project_change_item_ids(change_event);
  const contains_items = updated_sections.includes("items");
  const delta_sections_only = updated_sections.every((section) =>
    ["items", "proofreading"].includes(section),
  );
  if (contains_items && item_ids.length > 0 && delta_sections_only) {
    return {
      reason: args.reason,
      mode: "delta",
      updated_sections,
      item_ids,
    };
  }

  if (contains_items || has_proofreading_only_section) {
    return {
      reason: args.reason,
      mode: "full",
      updated_sections,
      item_ids: [],
    };
  }

  return null;
}

function has_project_change_rel_paths(event: ProjectStoreChangeEvent): boolean {
  function has_rel_path(value: unknown): boolean {
    const rel_path = String(value ?? "").trim();
    return rel_path !== "";
  }

  for (const operation of event.operations) {
    for (const item of Object.values(operation.items?.upsert ?? {})) {
      if (has_rel_path(item.file_path)) {
        return true;
      }
    }
    for (const file of Object.values(operation.files?.upsert ?? {})) {
      if (has_rel_path(file.rel_path ?? file.file_path)) {
        return true;
      }
    }
  }

  return false;
}

function is_project_change_workbench_delta(event: ProjectStoreChangeEvent): boolean {
  if (!event.updatedSections.includes("items")) {
    return false;
  }

  if (!event.updatedSections.every((section) => ["items", "proofreading"].includes(section))) {
    return false;
  }

  return event.operations.every(
    (operation) => operation.items !== undefined || operation.sections?.proofreading !== undefined,
  );
}

function resolve_workbench_change_signal(args: {
  reason: string;
  updated_sections: ProjectStoreStage[];
  change_event: ProjectStoreChangeEvent;
}): WorkbenchChangeSignalInput | null {
  if (!args.updated_sections.some((section) => WORKBENCH_REFRESH_SECTIONS.includes(section))) {
    return null;
  }

  const item_ids = [...new Set(collect_project_change_item_ids(args.change_event))];
  const can_apply_items_delta =
    item_ids.length > 0 && is_project_change_workbench_delta(args.change_event);

  return {
    reason: args.reason,
    scope: has_project_change_rel_paths(args.change_event) ? "file" : "global",
    mode: can_apply_items_delta ? "items_delta" : "full",
    updated_sections: args.updated_sections,
    item_ids,
  };
}

// 批量派生信号需要稳定 section 顺序，避免同一窗口内重复唤醒页面缓存
function collect_unique_updated_sections(
  events: readonly ProjectStoreChangeEvent[],
): ProjectStoreStage[] {
  return [...new Set(events.flatMap((event) => event.updatedSections))];
}

// 多来源合帧时统一使用批次原因，避免把某一条事件来源误认为整批语义
function resolve_project_change_batch_reason(events: readonly ProjectStoreChangeEvent[]): string {
  const reasons = [...new Set(events.map((event) => event.source || "project_change"))];
  return reasons.length === 1 ? reasons[0] ?? "project_change" : "project_change_batch";
}

// 工作台信号按同一刷新窗口合并，任一 full 或 file 影响都会提升整批刷新级别
function resolve_workbench_change_signal_batch(
  events: readonly ProjectStoreChangeEvent[],
): WorkbenchChangeSignalInput | null {
  const reason = resolve_project_change_batch_reason(events);
  const signals = events
    .map((event) =>
      resolve_workbench_change_signal({
        reason,
        updated_sections: event.updatedSections,
        change_event: event,
      }),
    )
    .filter((signal): signal is WorkbenchChangeSignalInput => signal !== null);
  if (signals.length === 0) {
    return null;
  }

  const has_full_refresh = signals.some((signal) => signal.mode === "full");
  return {
    reason,
    scope: signals.some((signal) => signal.scope === "file") ? "file" : "global",
    mode: has_full_refresh ? "full" : "items_delta",
    updated_sections: collect_unique_updated_sections(events),
    item_ids: has_full_refresh ? [] : [...new Set(signals.flatMap((signal) => signal.item_ids))],
  };
}

// 校对页信号按 full > delta > noop 合并，delta item ids 在窗口内稳定去重
function resolve_proofreading_change_signal_batch(
  events: readonly ProjectStoreChangeEvent[],
): ProofreadingChangeSignalInput | null {
  const reason = resolve_project_change_batch_reason(events);
  const signals = events
    .map((event) =>
      resolve_proofreading_change_signal({
        reason,
        updated_sections: event.updatedSections,
        change_event: event,
      }),
    )
    .filter((signal): signal is ProofreadingChangeSignalInput => signal !== null);
  if (signals.length === 0) {
    return null;
  }

  const mode: ProofreadingChangeMode = signals.some((signal) => signal.mode === "full")
    ? "full"
    : signals.some((signal) => signal.mode === "delta")
      ? "delta"
      : "noop";
  return {
    reason,
    mode,
    updated_sections: collect_unique_updated_sections(events),
    item_ids: mode === "delta" ? [...new Set(signals.flatMap((signal) => signal.item_ids))] : [],
  };
}

// 终态快照必须解除交互等待，不能被普通 500ms 合帧窗口延迟
function should_apply_task_snapshot_immediately(snapshot: TaskSnapshot): boolean {
  return (
    !snapshot.busy ||
    snapshot.status === "idle" ||
    snapshot.status === "done" ||
    snapshot.status === "error"
  );
}

/**
 * 大 section 失效事件必须转成补读清单，避免只推进 revision 却复用旧实体
 */
function collect_project_change_invalidated_sections(
  event: ProjectStoreChangeEvent,
): ProjectStoreStage[] {
  const sections = new Set<ProjectStoreStage>();
  for (const operation of event.operations) {
    if (operation.items?.payloadMode === "section-invalidated") {
      sections.add("items");
    }
    if (operation.files?.payloadMode === "section-invalidated") {
      sections.add("files");
    }
    for (const [section, payload] of Object.entries(operation.sections ?? {})) {
      if (isProjectStoreStage(section) && payload?.payloadMode === "section-invalidated") {
        sections.add(section);
      }
    }
  }
  return [...sections];
}

function build_local_project_change_revisions(
  current_revisions: ProjectStoreState["revisions"],
  updated_sections: ProjectStoreStage[],
): {
  projectRevision: number;
  sectionRevisions: ProjectStoreSectionRevisions;
} {
  const current_max_revision = Math.max(
    current_revisions.projectRevision,
    ...Object.values(current_revisions.sections),
  );
  const next_section_revisions: ProjectStoreSectionRevisions = {};

  for (const section of updated_sections) {
    next_section_revisions[section] = (current_revisions.sections[section] ?? 0) + 1;
  }

  return {
    projectRevision: current_max_revision + 1,
    sectionRevisions: next_section_revisions,
  };
}

function collect_previous_section_revisions(
  current_revisions: ProjectStoreState["revisions"],
  updated_sections: ProjectStoreStage[],
): ProjectStoreSectionRevisions {
  const previous_section_revisions: ProjectStoreSectionRevisions = {};

  for (const section of updated_sections) {
    previous_section_revisions[section] = current_revisions.sections[section] ?? 0;
  }

  return previous_section_revisions;
}

function build_local_project_change_rollback_change(args: {
  updatedSections: ProjectStoreStage[];
  previousSections: Partial<ProjectStoreSectionStateMap>;
}): ProjectStoreChangeOperation[] {
  return args.updatedSections.map((section) => {
    const previous_section = args.previousSections[section];
    if (previous_section === undefined) {
      throw new Error(`缺少 ${section} 的回滚快照。`);
    }

    return createProjectStoreReplaceSectionChange(section, previous_section);
  });
}

export function DesktopRuntimeProvider(props: { children: ReactNode }): JSX.Element {
  const [hydration_ready, set_hydration_ready] = useState(false);
  const [hydration_error, set_hydration_error] = useState<string | null>(null);
  const [settings_snapshot, set_settings_snapshot] =
    useState<SettingsSnapshot>(DEFAULT_SETTINGS_SNAPSHOT);
  const [project_snapshot, set_project_snapshot] =
    useState<ProjectSnapshot>(DEFAULT_PROJECT_SNAPSHOT);
  const task_runtime_store_ref = useRef(createTaskRuntimeStore());
  const task_snapshot = useSyncExternalStore(
    task_runtime_store_ref.current.subscribe,
    task_runtime_store_ref.current.getSnapshot,
  );
  const set_task_snapshot = useCallback((snapshot: TaskSnapshot): void => {
    task_runtime_store_ref.current.applySnapshot(snapshot);
  }, []);
  const [proofreading_change_signal, set_proofreading_change_signal] =
    useState<ProofreadingChangeSignal>(DEFAULT_PROOFREADING_CHANGE_SIGNAL);
  const [workbench_change_signal, set_workbench_change_signal] = useState<WorkbenchChangeSignal>(
    DEFAULT_WORKBENCH_CHANGE_SIGNAL,
  );
  const [project_warmup_status, set_project_warmup_status] = useState<ProjectWarmupStatus>("idle");
  const [project_warmup_stage, set_project_warmup_stage] = useState<ProjectStoreStage | null>(null);
  const [pending_target_route, set_pending_target_route] = useState<RouteId | null>(null);
  const [is_app_language_updating, set_is_app_language_updating] = useState(false);
  const project_store_ref = useRef(createProjectStore());
  const runtime_refresh_scheduler_ref = useRef<DesktopRuntimeRefreshScheduler | null>(null); // 本地操作和项目刷新通过 ref 先冲刷 SSE pending 队列

  const apply_settings_snapshot = useCallback(
    (payload: SettingsSnapshotPayload): SettingsSnapshot => {
      const next_snapshot = normalize_settings_snapshot(payload);
      set_settings_snapshot(next_snapshot);
      return next_snapshot;
    },
    [],
  );

  const refresh_settings = useCallback(async (): Promise<SettingsSnapshot> => {
    const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/app", {});
    return apply_settings_snapshot(payload);
  }, [apply_settings_snapshot]);

  const flush_runtime_refresh_scheduler = useCallback((): void => {
    runtime_refresh_scheduler_ref.current?.flush();
  }, []);

  const refresh_task = useCallback(async (): Promise<TaskSnapshot> => {
    const payload = await api_fetch<TaskSnapshotPayload>("/api/tasks/snapshot", {});
    const next_snapshot = normalize_task_snapshot(payload);
    set_task_snapshot(next_snapshot);
    return next_snapshot;
  }, [set_task_snapshot]);

  const update_app_language = useCallback(
    async (language: AppLanguage): Promise<SettingsSnapshot> => {
      if (is_app_language_updating || settings_snapshot.app_language === language) {
        return settings_snapshot;
      }

      set_is_app_language_updating(true);
      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
          app_language: language,
        });
        return apply_settings_snapshot(payload);
      } finally {
        set_is_app_language_updating(false);
      }
    },
    [apply_settings_snapshot, is_app_language_updating, settings_snapshot],
  );

  const bump_workbench_runtime_signal = useCallback(
    (args: WorkbenchChangeSignalInput): void => {
      set_workbench_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: args.reason,
        scope: args.scope,
        mode: args.mode,
        updated_sections: [...args.updated_sections],
        item_ids: [...args.item_ids],
      }));
    },
    [],
  );

  const bump_proofreading_runtime_signal = useCallback(
    (args: ProofreadingChangeSignalInput): void => {
      set_proofreading_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: args.reason,
        mode: args.mode,
        updated_sections: [...args.updated_sections],
        item_ids: [...args.item_ids],
      }));
    },
    [],
  );

  const apply_runtime_project_change = useCallback(
    (
      change_event: ProjectStoreChangeEvent,
      revision_mode: ProjectStoreChangeRevisionMode = "merge",
    ): void => {
      project_store_ref.current.applyProjectChange(change_event, {
        revisionMode: revision_mode,
      });

      const updated_sections = change_event.updatedSections;
      const reason = change_event.source || "project_change";
      const workbench_change_signal = resolve_workbench_change_signal({
        reason,
        updated_sections,
        change_event,
      });
      if (workbench_change_signal !== null) {
        bump_workbench_runtime_signal(workbench_change_signal);
      }

      const proofreading_change_signal = resolve_proofreading_change_signal({
        reason,
        updated_sections,
        change_event,
      });
      if (proofreading_change_signal !== null) {
        bump_proofreading_runtime_signal(proofreading_change_signal);
      }
    },
    [bump_proofreading_runtime_signal, bump_workbench_runtime_signal],
  );

  const apply_runtime_project_change_batch = useCallback(
    (change_events: readonly ProjectStoreChangeEvent[]): void => {
      if (change_events.length === 0) {
        return;
      }

      // 同一刷新窗口内 project 事实只写一次 store，再合并页面级派生信号
      project_store_ref.current.applyProjectChangeBatch(change_events);

      const workbench_change_signal = resolve_workbench_change_signal_batch(change_events);
      if (workbench_change_signal !== null) {
        bump_workbench_runtime_signal(workbench_change_signal);
      }

      const proofreading_change_signal = resolve_proofreading_change_signal_batch(change_events);
      if (proofreading_change_signal !== null) {
        bump_proofreading_runtime_signal(proofreading_change_signal);
      }
    },
    [bump_proofreading_runtime_signal, bump_workbench_runtime_signal],
  );

  const should_apply_runtime_project_change = useCallback(
    (change_event: ProjectStoreChangeEvent): boolean => {
      const current_revisions = project_store_ref.current.getState().revisions;
      const next_project_revision = Number(change_event.projectRevision);
      if (
        Number.isFinite(next_project_revision) &&
        next_project_revision > 0 &&
        next_project_revision < current_revisions.projectRevision
      ) {
        return false;
      }

      for (const section of change_event.updatedSections) {
        const next_section_revision = change_event.sectionRevisions?.[section];
        const current_section_revision = current_revisions.sections[section] ?? 0;
        if (
          next_section_revision !== undefined &&
          next_section_revision < current_section_revision
        ) {
          return false;
        }
      }

      return true;
    },
    [],
  );

  const read_project_items_by_ids = useCallback(
    async (
      request: DesktopRuntimeProjectItemsReadRequest,
    ): Promise<ProjectStoreChangeEvent | null> => {
      const read_items_payload = await api_fetch<ProjectReadItemsByIdsPayload>(
        "/api/project/items/read-by-ids",
        {
          itemIds: request.itemIds,
        },
      );
      return normalize_project_read_items_by_ids_event({
        source: request.source,
        projectRevision: request.projectRevision,
        itemIds: request.itemIds,
        payload: read_items_payload,
      });
    },
    [],
  );

  const refresh_project_runtime = useCallback(async (): Promise<void> => {
    flush_runtime_refresh_scheduler();

    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      project_store_ref.current.reset();
      set_project_warmup_stage(null);
      return;
    }

    set_project_warmup_status("warming");
    set_project_warmup_stage(null);
    project_store_ref.current.reset();
    const manifest = await api_fetch<ProjectManifestPayload>("/api/project/manifest", {});
    const next_project_snapshot = normalize_project_snapshot({ project: manifest.project });
    if (next_project_snapshot.loaded) {
      set_project_snapshot(next_project_snapshot);
    }
    project_store_ref.current.alignRevisions({
      projectRevision: Number(manifest.projectRevision ?? 0),
      sectionRevisions: normalize_section_revisions(manifest.sectionRevisions) ?? {},
    });
    const read_sections_payload = await api_fetch<ProjectReadSectionsPayload>(
      "/api/project/read-sections",
      {
        sections: [...PROJECT_DATA_SECTIONS],
      },
    );
    const read_sections_event = normalize_project_read_sections_event(read_sections_payload);
    if (read_sections_event !== null) {
      apply_runtime_project_change(read_sections_event, "exact");
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    flush_runtime_refresh_scheduler,
    set_project_warmup_status,
    apply_runtime_project_change,
  ]);

  const align_project_runtime_ack = useCallback((ack: ProjectMutationAck): void => {
    if (!ack.accepted) {
      return;
    }

    project_store_ref.current.alignRevisions({
      projectRevision: ack.projectRevision,
      sectionRevisions: ack.sectionRevisions,
    });
  }, []);

  const commit_local_project_change = useCallback(
    (input: LocalProjectChangeInput): LocalProjectChangeCommit => {
      if (input.updatedSections.length === 0) {
        throw new Error("本地 project change 至少需要一个 updated section。");
      }

      flush_runtime_refresh_scheduler();
      const current_state = project_store_ref.current.getState();
      const previous_sections = snapshotProjectStoreSections(current_state, input.updatedSections);
      const previous_project_revision = current_state.revisions.projectRevision;
      const previous_section_revisions = collect_previous_section_revisions(
        current_state.revisions,
        input.updatedSections,
      );
      const next_revisions = build_local_project_change_revisions(
        current_state.revisions,
        input.updatedSections,
      );

      apply_runtime_project_change(
        {
          source: input.source,
          projectRevision: next_revisions.projectRevision,
          updatedSections: input.updatedSections,
          operations: input.operations,
          sectionRevisions: next_revisions.sectionRevisions,
        },
        "exact",
      );

      let rolled_back = false;
      return {
        previousProjectRevision: previous_project_revision,
        previousSectionRevisions: previous_section_revisions,
        previousSections: previous_sections,
        rollback: (source = `${input.source}_rollback`) => {
          if (rolled_back) {
            return;
          }

          rolled_back = true;
          apply_runtime_project_change(
            {
              source,
              projectRevision: previous_project_revision,
              updatedSections: input.updatedSections,
              operations:
                input.rollbackOperations ??
                build_local_project_change_rollback_change({
                  updatedSections: input.updatedSections,
                  previousSections: previous_sections,
                }),
              sectionRevisions: previous_section_revisions,
            },
            "exact",
          );
        },
      };
    },
    [apply_runtime_project_change, flush_runtime_refresh_scheduler],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate_runtime(): Promise<void> {
      try {
        // Core API 状态是共享权威源，渲染层启动或热更新时不能通过卸载工程去“重置会话”，否则开发态的 StrictMode、Fast Refresh 或整页重载都会把外部手动打开的旧应用状态一起清空
        const [next_settings, next_project, next_task] = await Promise.all([
          api_fetch<SettingsSnapshotPayload>("/api/settings/app", {}),
          api_fetch<ProjectSnapshotPayload>("/api/project/snapshot", {}),
          api_fetch<TaskSnapshotPayload>("/api/tasks/snapshot", {}),
        ]);
        if (cancelled) {
          return;
        }

        apply_settings_snapshot(next_settings);
        set_project_snapshot(normalize_project_snapshot(next_project));
        set_task_snapshot(normalize_task_snapshot(next_task));
        set_hydration_error(null);
        set_hydration_ready(true);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "桌面运行时初始化失败。";
        set_hydration_error(message);
        set_hydration_ready(true);
      }
    }

    void hydrate_runtime();

    return () => {
      cancelled = true;
    };
  }, [apply_settings_snapshot]);

  useEffect(() => {
    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      project_store_ref.current.reset();
      set_project_warmup_stage(null);
      return;
    }

    let cancelled = false;

    async function refresh_loaded_project_runtime(): Promise<void> {
      try {
        await refresh_project_runtime();
      } catch {
        return;
      }

      if (cancelled) {
        return;
      }
    }

    void refresh_loaded_project_runtime();

    return () => {
      cancelled = true;
    };
  }, [project_snapshot.loaded, project_snapshot.path, refresh_project_runtime]);

  useEffect(() => {
    if (project_warmup_status === "ready") {
      set_project_warmup_stage(null);
    }
  }, [project_warmup_status]);

  useEffect(() => {
    let event_source: EventSource | null = null;
    let cancelled = false;
    const runtime_refresh_scheduler = new DesktopRuntimeRefreshScheduler({
      applyTaskSnapshot: (snapshot) => {
        task_runtime_store_ref.current.applySnapshot(snapshot);
      },
      applyProjectChangeBatch: apply_runtime_project_change_batch,
      readProjectItemsByIds: read_project_items_by_ids,
      shouldApplyProjectChange: should_apply_runtime_project_change,
    });
    runtime_refresh_scheduler_ref.current = runtime_refresh_scheduler;

    function handle_project_changed(event: MessageEvent<string>): void {
      runtime_refresh_scheduler.flush();
      const payload = parse_event_payload(event);
      set_project_snapshot({
        path: String(payload.path ?? ""),
        loaded: Boolean(payload.loaded),
      });
      void refresh_task();
    }

    function handle_task_snapshot_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event);
      const task_snapshot = normalize_task_snapshot(payload);
      if (should_apply_task_snapshot_immediately(task_snapshot)) {
        runtime_refresh_scheduler.flush();
        task_runtime_store_ref.current.applySnapshot(task_snapshot);
        return;
      }

      runtime_refresh_scheduler.enqueue_task_snapshot(task_snapshot);
    }

    function handle_settings_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event) as SettingsChangedEventPayload;

      if (typeof payload.settings === "object" && payload.settings !== null) {
        apply_settings_snapshot({
          settings: payload.settings,
        });
      } else {
        void refresh_settings();
      }
    }

    async function handle_project_data_changed(event: MessageEvent<string>): Promise<void> {
      const payload = parse_event_payload(event) as ProjectChangeEventPayload;
      const change_event = normalize_project_change_event(payload);
      const updated_sections = normalize_section_array(payload.updatedSections).filter(
        isProjectStoreStage,
      );
      const reason = String(payload.source ?? "project_change");

      if (change_event === null) {
        runtime_refresh_scheduler.flush();
        if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
          return;
        }

        try {
          await refresh_project_runtime();
        } catch {
          return;
        }

        if (cancelled) {
          return;
        }

        if (updated_sections.some((section) => WORKBENCH_REFRESH_SECTIONS.includes(section))) {
          bump_workbench_runtime_signal({
            reason,
            scope: "global",
            mode: "full",
            updated_sections,
            item_ids: [],
          });
        }

        const proofreading_change_signal = resolve_proofreading_change_signal({
          reason,
          updated_sections,
          change_event: null,
        });
        if (proofreading_change_signal !== null) {
          bump_proofreading_runtime_signal(proofreading_change_signal);
        }

        return;
      }

      if (cancelled) {
        return;
      }

      const invalidated_sections = collect_project_change_invalidated_sections(change_event);
      if (invalidated_sections.length > 0) {
        runtime_refresh_scheduler.flush();
        if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
          return;
        }

        const read_sections_payload = await api_fetch<ProjectReadSectionsPayload>(
          "/api/project/read-sections",
          {
            sections: invalidated_sections,
          },
        );
        if (cancelled) {
          return;
        }
        const read_sections_event = normalize_project_read_sections_event(read_sections_payload);
        if (read_sections_event !== null) {
          apply_runtime_project_change(
            {
              ...read_sections_event,
              source: reason,
            },
            "exact",
          );
        }
        return;
      }

      const ids_only_item_ids = collect_project_change_ids_only_item_ids(change_event);
      if (ids_only_item_ids.length > 0) {
        if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
          return;
        }

        runtime_refresh_scheduler.enqueue_project_items_read({
          source: reason,
          projectRevision: change_event.projectRevision,
          itemIds: ids_only_item_ids,
        });
        return;
      }

      runtime_refresh_scheduler.enqueue_project_change(change_event);
    }

    async function attach_event_stream(): Promise<void> {
      try {
        const next_event_source = await open_event_stream();
        if (cancelled) {
          next_event_source.close();
          return;
        }

        event_source = next_event_source;
        event_source.addEventListener("project.changed", handle_project_changed as EventListener);
        event_source.addEventListener(
          "task.snapshot_changed",
          handle_task_snapshot_changed as EventListener,
        );
        event_source.addEventListener("settings.changed", handle_settings_changed as EventListener);
        event_source.addEventListener(PROJECT_CHANGE_EVENT_TOPIC, ((
          event: MessageEvent<string>,
        ) => {
          void handle_project_data_changed(event);
        }) as EventListener);
      } catch {
        return;
      }
    }

    void attach_event_stream();

    return () => {
      cancelled = true;
      if (runtime_refresh_scheduler_ref.current === runtime_refresh_scheduler) {
        runtime_refresh_scheduler_ref.current = null;
      }
      runtime_refresh_scheduler.dispose();
      event_source?.close();
    };
  }, [
    apply_settings_snapshot,
    apply_runtime_project_change_batch,
    apply_runtime_project_change,
    bump_proofreading_runtime_signal,
    bump_workbench_runtime_signal,
    project_snapshot.loaded,
    project_snapshot.path,
    read_project_items_by_ids,
    refresh_settings,
    refresh_project_runtime,
    refresh_task,
    should_apply_runtime_project_change,
  ]);

  const context_value = useMemo<DesktopRuntimeContextValue>(() => {
    return {
      hydration_ready,
      hydration_error,
      settings_snapshot,
      project_snapshot,
      task_snapshot,
      proofreading_change_signal,
      workbench_change_signal,
      project_warmup_status,
      project_warmup_stage,
      pending_target_route,
      is_app_language_updating,
      set_settings_snapshot,
      set_project_snapshot,
      set_task_snapshot,
      set_project_warmup_status,
      set_pending_target_route,
      project_store: project_store_ref.current,
      commit_local_project_change,
      refresh_project_runtime,
      align_project_runtime_ack,
      update_app_language,
      refresh_settings,
      refresh_task,
    };
  }, [
    hydration_ready,
    hydration_error,
    settings_snapshot,
    project_snapshot,
    task_snapshot,
    proofreading_change_signal,
    workbench_change_signal,
    project_warmup_status,
    project_warmup_stage,
    pending_target_route,
    is_app_language_updating,
    align_project_runtime_ack,
    commit_local_project_change,
    refresh_project_runtime,
    refresh_settings,
    refresh_task,
    update_app_language,
  ]);

  return (
    <DesktopRuntimeContext.Provider value={context_value}>
      {props.children}
    </DesktopRuntimeContext.Provider>
  );
}
