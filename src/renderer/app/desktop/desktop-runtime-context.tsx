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
  createProjectStore,
  isProjectStoreStage,
  type ProjectStoreChangeEvent,
  type ProjectStoreChangeRevisionMode,
  type ProjectStoreReader,
  type ProjectStoreStage,
} from "@/project/store/project-store";
import {
  createTaskRuntimeStore,
  normalize_task_snapshot,
  type TaskSnapshot,
} from "@/app/desktop/task-runtime-store";
import { DesktopRuntimeRefreshScheduler } from "@/app/desktop/desktop-runtime-refresh-scheduler";
import {
  normalize_section_array,
  normalize_section_revisions,
  parse_event_payload,
} from "@/app/desktop/desktop-runtime-event-payload";
import {
  normalize_setting_snapshot,
  type AppLanguage,
  type RecentProjectSetting,
  type SettingSnapshot,
} from "@base/setting";
import type { TaskType } from "@shared/task";
import {
  PROJECT_CHANGE_EVENT_TOPIC,
  PROJECT_DATA_SECTIONS,
  normalizeProjectChangePayloadMode,
  type ProjectChangeItemFieldPatch,
  type ProjectChangePayloadMode,
  type ProjectChangeJsonRecord,
} from "@shared/project/event";
import { InternalInvariantError } from "@shared/error";

type RecentProjectEntry = RecentProjectSetting;

export type SettingsSnapshot = SettingSnapshot;

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
  field_patch: ProjectChangeItemFieldPatch | null;
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
const APPLIED_PROJECT_EVENT_ID_LIMIT = 256; // 去重窗口只覆盖近期 HTTP/SSE 同源事件，避免长期保存事件历史

type ProjectWarmupStatus = "idle" | "warming" | "ready";

type RuntimeProjectIdentity = {
  path: string; // 后端会话确认的当前项目路径，独立于可能滞后的 ProjectStore 镜像
  epoch: number; // 每次项目切换或完整 warmup 递增，用于丢弃迟到补读和旧快照
  phase: ProjectWarmupStatus; // 这里只表示 ProjectStore 初始化阶段，不等同于页面缓存 warmup 状态
};

const EMPTY_RUNTIME_PROJECT_IDENTITY: RuntimeProjectIdentity = {
  path: "",
  epoch: 0,
  phase: "idle",
};

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
  set_project_warmup_status: (status: ProjectWarmupStatus) => void;
  set_pending_target_route: (route_id: RouteId | null) => void;
  project_store: ProjectStoreReader;
  apply_settings_snapshot: (payload: SettingsSnapshotPayload) => SettingsSnapshot;
  sync_task_snapshot: (snapshot: TaskSnapshot) => void;
  refresh_project_snapshot: () => Promise<ProjectSnapshot>;
  refresh_project_runtime: () => Promise<void>;
  apply_project_mutation_result: (result: ProjectMutationResult) => Promise<void>;
  update_app_language: (language: AppLanguage) => Promise<SettingsSnapshot>;
  refresh_settings: () => Promise<SettingsSnapshot>;
  refresh_task: (task_type?: TaskType) => Promise<TaskSnapshot>;
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

type TaskSnapshotRequest = {
  task_type?: TaskType; // 显式 task_type 用于任务页刷新，避免空闲态按后端默认类型误判
};

type SettingsChangedEventPayload = {
  keys?: unknown;
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>;
  };
};

type ProjectChangeEventPayload = {
  eventId?: unknown;
  source?: unknown;
  projectPath?: unknown;
  projectRevision?: unknown;
  updatedSections?: unknown;
  items?: unknown;
  files?: unknown;
  sections?: unknown;
  sectionRevisions?: unknown;
};

type ProjectManifestPayload = {
  projectPath?: unknown;
  project?: Partial<ProjectSnapshot>;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
};

type ProjectReadSectionsPayload = {
  projectPath?: unknown;
  sections?: unknown;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
};

export type ProjectMutationResultPayload = {
  accepted?: unknown;
  changes?: unknown;
  failed_files?: unknown;
};

export type ProjectMutationResult = {
  accepted: true;
  changes: ProjectStoreChangeEvent[];
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
  field_patch: null,
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

export function normalize_settings_snapshot(payload: SettingsSnapshotPayload): SettingsSnapshot {
  return normalize_setting_snapshot(payload.settings);
}

function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  const snapshot = payload.project ?? {};
  return {
    path: String(snapshot.path ?? ""),
    loaded: Boolean(snapshot.loaded),
  };
}

export function normalize_project_mutation_result(
  payload: ProjectMutationResultPayload,
): ProjectMutationResult {
  if (payload.accepted !== true || !Array.isArray(payload.changes)) {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "invalid_project_mutation_result_payload" },
    });
  }

  return {
    accepted: true,
    // mutation result 是同步 HTTP 的 canonical 事实入口；任何无法规范化的 change 都暴露为协议错误
    changes: payload.changes.map((change, index) =>
      normalize_project_mutation_change_event(change, index),
    ),
  };
}

function normalize_project_mutation_change_event(
  change: unknown,
  index: number,
): ProjectStoreChangeEvent {
  if (!is_record(change)) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "invalid_project_mutation_change_record",
        index,
      },
    });
  }

  const normalized_change = normalize_project_change_event(change);
  if (normalized_change === null) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "invalid_project_mutation_change_payload",
        index,
      },
    });
  }
  return normalized_change;
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

function normalize_project_change_item_field_patch(value: unknown): ProjectChangeItemFieldPatch {
  if (!is_record(value)) {
    return {};
  }
  const patch: ProjectChangeItemFieldPatch = {};
  if (typeof value.dst === "string") {
    patch.dst = value.dst;
  }
  if (typeof value.status === "string") {
    patch.status = value.status;
  }
  const retry_count = Number(value.retry_count);
  if (Number.isFinite(retry_count)) {
    patch.retry_count = Math.trunc(retry_count);
  }
  return patch;
}

function normalize_project_change_event(
  payload: ProjectChangeEventPayload,
): ProjectStoreChangeEvent | null {
  const project_path = String(payload.projectPath ?? "").trim();
  const updated_sections = normalize_section_array(payload.updatedSections).filter(
    isProjectStoreStage,
  );
  if (project_path === "" || updated_sections.length === 0) {
    return null;
  }

  const items = is_record(payload.items)
    ? {
        payloadMode: normalizeProjectChangePayloadMode(payload.items.payloadMode),
        upsert: normalize_record_map(payload.items.upsert),
        fieldPatch: normalize_project_change_item_field_patch(payload.items.fieldPatch),
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
    eventId: String(payload.eventId ?? ""),
    source: String(payload.source ?? "project_change"),
    projectPath: project_path,
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
  const project_path = String(payload.projectPath ?? "").trim();
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
  if (project_path === "" || updated_sections.length === 0) {
    return null;
  }

  return {
    source: "project_read_sections",
    projectPath: project_path,
    projectRevision: Number(payload.projectRevision ?? 0),
    updatedSections: updated_sections,
    operations: [{ sections }],
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions),
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

function clone_project_change_item_field_patch(
  patch: ProjectChangeItemFieldPatch,
): ProjectChangeItemFieldPatch {
  return {
    ...(patch.dst === undefined ? {} : { dst: patch.dst }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.retry_count === undefined ? {} : { retry_count: patch.retry_count }),
  };
}

function are_project_change_item_field_patches_equal(
  left: ProjectChangeItemFieldPatch,
  right: ProjectChangeItemFieldPatch,
): boolean {
  return (
    left.dst === right.dst && left.status === right.status && left.retry_count === right.retry_count
  );
}

// 只有同一窗口内所有 item delta 都是同一个字段 patch 时，校对 worker 才走零 DTO 增量。
function collect_project_change_item_field_patch(
  event: ProjectStoreChangeEvent,
): ProjectChangeItemFieldPatch | null {
  let field_patch: ProjectChangeItemFieldPatch | null = null;
  for (const operation of event.operations) {
    if (operation.items === undefined) {
      continue;
    }
    if (operation.items.payloadMode !== "field-patch" || operation.items.fieldPatch === undefined) {
      return null;
    }
    const next_patch = clone_project_change_item_field_patch(operation.items.fieldPatch);
    if (
      field_patch !== null &&
      !are_project_change_item_field_patches_equal(field_patch, next_patch)
    ) {
      return null;
    }
    field_patch = next_patch;
  }
  return field_patch;
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
        field_patch: null,
      };
    }

    if (has_proofreading_only_section) {
      return {
        reason: args.reason,
        mode: "noop",
        updated_sections,
        item_ids: [],
        field_patch: null,
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
      field_patch: null,
    };
  }

  if (updated_sections.every((section) => section === "proofreading")) {
    return {
      reason: args.reason,
      mode: "noop",
      updated_sections,
      item_ids: [],
      field_patch: null,
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
      field_patch: collect_project_change_item_field_patch(change_event),
    };
  }

  if (contains_items || has_proofreading_only_section) {
    return {
      reason: args.reason,
      mode: "full",
      updated_sections,
      item_ids: [],
      field_patch: null,
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
  return reasons.length === 1 ? (reasons[0] ?? "project_change") : "project_change_batch";
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
  const delta_signals = signals.filter((signal) => signal.mode === "delta");
  let field_patch: ProjectChangeItemFieldPatch | null = null;
  let can_use_field_patch = mode === "delta" && delta_signals.length > 0;
  for (const signal of delta_signals) {
    if (signal.field_patch === null) {
      can_use_field_patch = false;
      break;
    }
    if (field_patch === null) {
      field_patch = clone_project_change_item_field_patch(signal.field_patch);
      continue;
    }
    if (!are_project_change_item_field_patches_equal(field_patch, signal.field_patch)) {
      can_use_field_patch = false;
      break;
    }
  }
  if (!can_use_field_patch) {
    field_patch = null;
  }
  return {
    reason,
    mode,
    updated_sections: collect_unique_updated_sections(events),
    item_ids: mode === "delta" ? [...new Set(signals.flatMap((signal) => signal.item_ids))] : [],
    field_patch,
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

/**
 * 缺少后端 revision 的变更不能直接写入 ProjectStore，必须补读 canonical section
 */
function collect_project_change_missing_revision_sections(
  event: ProjectStoreChangeEvent,
): ProjectStoreStage[] {
  return event.updatedSections.filter((section) => {
    return event.sectionRevisions?.[section] === undefined;
  });
}

/**
 * section 失效或 revision 缺失都走补读，避免 renderer 自行推进版本事实
 */
function collect_project_change_sections_requiring_read(
  event: ProjectStoreChangeEvent,
): ProjectStoreStage[] {
  return [
    ...new Set([
      ...collect_project_change_invalidated_sections(event),
      ...collect_project_change_missing_revision_sections(event),
    ]),
  ];
}

export function DesktopRuntimeProvider(props: { children: ReactNode }): JSX.Element {
  const [hydration_ready, set_hydration_ready] = useState(false);
  const [hydration_error, set_hydration_error] = useState<string | null>(null);
  const [settings_snapshot, write_settings_snapshot] = useState<SettingsSnapshot>(() =>
    normalize_settings_snapshot({}),
  );
  const [project_snapshot, write_project_snapshot] =
    useState<ProjectSnapshot>(DEFAULT_PROJECT_SNAPSHOT);
  const task_runtime_store_ref = useRef(createTaskRuntimeStore());
  const task_snapshot = useSyncExternalStore(
    task_runtime_store_ref.current.subscribe,
    task_runtime_store_ref.current.getSnapshot,
  );
  const sync_task_snapshot = useCallback((snapshot: TaskSnapshot): void => {
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
  const project_store_reader_ref = useRef<ProjectStoreReader | null>(null); // context 只暴露稳定只读门面，写入口留在 Provider 内
  if (project_store_reader_ref.current === null) {
    project_store_reader_ref.current = {
      getState: () => project_store_ref.current.getState(),
      getRevisionCheckpoint: () => project_store_ref.current.getRevisionCheckpoint(),
      subscribe: (listener) => project_store_ref.current.subscribe(listener),
    };
  }
  const project_store_reader = project_store_reader_ref.current;
  if (project_store_reader === null) {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "project_store_reader_uninitialized" },
    });
  }
  const runtime_refresh_scheduler_ref = useRef<DesktopRuntimeRefreshScheduler | null>(null); // 本地操作和项目刷新通过 ref 先冲刷 SSE pending 队列
  const applied_project_event_ids_ref = useRef<Set<string>>(new Set());
  const applied_project_event_id_order_ref = useRef<string[]>([]);
  const runtime_project_identity_ref = useRef<RuntimeProjectIdentity>({
    ...EMPTY_RUNTIME_PROJECT_IDENTITY,
  });
  const pending_warmup_project_changes_ref = useRef<ProjectStoreChangeEvent[]>([]); // ProjectStore 完整快照落地前暂存当前项目事件，避免 warmup 窗口漏同步

  const apply_settings_snapshot = useCallback(
    (payload: SettingsSnapshotPayload): SettingsSnapshot => {
      const next_snapshot = normalize_settings_snapshot(payload);
      write_settings_snapshot(next_snapshot);
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

  const has_applied_project_event = useCallback((event_id: string | undefined): boolean => {
    return (
      event_id !== undefined &&
      event_id !== "" &&
      applied_project_event_ids_ref.current.has(event_id)
    );
  }, []);

  const mark_project_event_applied = useCallback((event_id: string | undefined): void => {
    if (event_id === undefined || event_id === "") {
      return;
    }
    const applied_event_ids = applied_project_event_ids_ref.current;
    if (applied_event_ids.has(event_id)) {
      return;
    }
    applied_event_ids.add(event_id);
    const event_id_order = applied_project_event_id_order_ref.current;
    event_id_order.push(event_id);
    while (event_id_order.length > APPLIED_PROJECT_EVENT_ID_LIMIT) {
      const expired_event_id = event_id_order.shift();
      if (expired_event_id !== undefined) {
        applied_event_ids.delete(expired_event_id);
      }
    }
  }, []);

  const clear_applied_project_events = useCallback((): void => {
    applied_project_event_ids_ref.current.clear();
    applied_project_event_id_order_ref.current = [];
  }, []);

  const read_runtime_project_identity = useCallback((): RuntimeProjectIdentity => {
    return runtime_project_identity_ref.current;
  }, []);

  const is_current_runtime_project_identity = useCallback(
    (identity: Pick<RuntimeProjectIdentity, "path" | "epoch">): boolean => {
      const current_identity = read_runtime_project_identity();
      return (
        identity.path !== "" &&
        current_identity.path === identity.path &&
        current_identity.epoch === identity.epoch
      );
    },
    [read_runtime_project_identity],
  );

  const is_current_runtime_project_warmup = useCallback(
    (identity: Pick<RuntimeProjectIdentity, "path" | "epoch">): boolean => {
      const current_identity = read_runtime_project_identity();
      return is_current_runtime_project_identity(identity) && current_identity.phase === "warming";
    },
    [is_current_runtime_project_identity, read_runtime_project_identity],
  );

  const clear_runtime_project_identity = useCallback((): void => {
    runtime_project_identity_ref.current = {
      path: "",
      epoch: runtime_project_identity_ref.current.epoch + 1,
      phase: "idle",
    };
    pending_warmup_project_changes_ref.current = [];
    clear_applied_project_events();
  }, [clear_applied_project_events]);

  const begin_runtime_project_warmup = useCallback(
    (project_path: string): RuntimeProjectIdentity => {
      const current_identity = runtime_project_identity_ref.current;
      if (current_identity.path === project_path && current_identity.phase === "warming") {
        return current_identity;
      }

      const next_identity: RuntimeProjectIdentity = {
        path: project_path,
        epoch: current_identity.epoch + 1,
        phase: "warming",
      };
      runtime_project_identity_ref.current = next_identity;
      pending_warmup_project_changes_ref.current = [];
      if (current_identity.path !== project_path) {
        clear_applied_project_events();
      }
      return next_identity;
    },
    [clear_applied_project_events],
  );

  const complete_runtime_project_warmup = useCallback(
    (identity: RuntimeProjectIdentity): ProjectStoreChangeEvent[] => {
      if (!is_current_runtime_project_identity(identity)) {
        return [];
      }

      runtime_project_identity_ref.current = {
        ...identity,
        phase: "ready",
      };
      const queued_changes = pending_warmup_project_changes_ref.current;
      pending_warmup_project_changes_ref.current = [];
      return queued_changes;
    },
    [is_current_runtime_project_identity],
  );

  const queue_runtime_project_change_during_warmup = useCallback(
    (change_event: ProjectStoreChangeEvent): boolean => {
      if (has_applied_project_event(change_event.eventId)) {
        return true;
      }

      const current_identity = read_runtime_project_identity();
      if (
        current_identity.phase !== "warming" ||
        current_identity.path === "" ||
        change_event.projectPath !== current_identity.path
      ) {
        return false;
      }

      pending_warmup_project_changes_ref.current.push(change_event);
      return true;
    },
    [has_applied_project_event, read_runtime_project_identity],
  );

  const sync_project_snapshot = useCallback(
    (snapshot: ProjectSnapshot): void => {
      write_project_snapshot(snapshot);
      const project_path = snapshot.loaded ? snapshot.path.trim() : "";
      if (project_path === "") {
        clear_runtime_project_identity();
        return;
      }

      const current_identity = runtime_project_identity_ref.current;
      if (current_identity.path !== project_path || current_identity.phase === "idle") {
        begin_runtime_project_warmup(project_path);
      }
    },
    [begin_runtime_project_warmup, clear_runtime_project_identity],
  );

  const refresh_project_snapshot = useCallback(async (): Promise<ProjectSnapshot> => {
    const payload = await api_fetch<ProjectSnapshotPayload>("/api/project/snapshot", {});
    const next_snapshot = normalize_project_snapshot(payload);
    sync_project_snapshot(next_snapshot);
    return next_snapshot;
  }, [sync_project_snapshot]);

  // 任务页主动刷新时要绑定任务类型；全局 hydration 才允许交给后端推断当前快照类型
  const refresh_task = useCallback(
    async (task_type?: TaskType): Promise<TaskSnapshot> => {
      const request: TaskSnapshotRequest = task_type === undefined ? {} : { task_type };
      const payload = await api_fetch<TaskSnapshotPayload>("/api/tasks/snapshot", request);
      const next_snapshot = normalize_task_snapshot(payload);
      sync_task_snapshot(next_snapshot);
      return next_snapshot;
    },
    [sync_task_snapshot],
  );

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

  const bump_workbench_runtime_signal = useCallback((args: WorkbenchChangeSignalInput): void => {
    set_workbench_change_signal((previous_signal) => ({
      seq: previous_signal.seq + 1,
      reason: args.reason,
      scope: args.scope,
      mode: args.mode,
      updated_sections: [...args.updated_sections],
      item_ids: [...args.item_ids],
    }));
  }, []);

  const bump_proofreading_runtime_signal = useCallback(
    (args: ProofreadingChangeSignalInput): void => {
      set_proofreading_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: args.reason,
        mode: args.mode,
        updated_sections: [...args.updated_sections],
        item_ids: [...args.item_ids],
        field_patch:
          args.field_patch === null
            ? null
            : clone_project_change_item_field_patch(args.field_patch),
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
      mark_project_event_applied(change_event.eventId);

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
    [bump_proofreading_runtime_signal, bump_workbench_runtime_signal, mark_project_event_applied],
  );

  const apply_runtime_project_change_batch = useCallback(
    (change_events: readonly ProjectStoreChangeEvent[]): void => {
      if (change_events.length === 0) {
        return;
      }

      // 同一刷新窗口内 project 事实只写一次 store，再合并页面级派生信号
      project_store_ref.current.applyProjectChangeBatch(change_events);
      for (const change_event of change_events) {
        mark_project_event_applied(change_event.eventId);
      }

      const workbench_change_signal = resolve_workbench_change_signal_batch(change_events);
      if (workbench_change_signal !== null) {
        bump_workbench_runtime_signal(workbench_change_signal);
      }

      const proofreading_change_signal = resolve_proofreading_change_signal_batch(change_events);
      if (proofreading_change_signal !== null) {
        bump_proofreading_runtime_signal(proofreading_change_signal);
      }
    },
    [bump_proofreading_runtime_signal, bump_workbench_runtime_signal, mark_project_event_applied],
  );

  const replace_runtime_project_data = useCallback(
    (change_event: ProjectStoreChangeEvent): void => {
      // 初始化快照绕过增量合并，从空态一次替换，再复用页面信号派发口径。
      project_store_ref.current.replaceProjectData(change_event);
      mark_project_event_applied(change_event.eventId);

      const updated_sections = change_event.updatedSections;
      const reason = change_event.source || "project_read_sections";
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
    [bump_proofreading_runtime_signal, bump_workbench_runtime_signal, mark_project_event_applied],
  );

  const should_apply_runtime_project_change = useCallback(
    (change_event: ProjectStoreChangeEvent): boolean => {
      if (has_applied_project_event(change_event.eventId)) {
        return false;
      }

      const current_identity = read_runtime_project_identity();
      if (
        current_identity.phase !== "ready" ||
        current_identity.path === "" ||
        change_event.projectPath !== current_identity.path
      ) {
        return false;
      }

      const current_revisions = project_store_ref.current.getState().revisions;

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
    [has_applied_project_event, read_runtime_project_identity],
  );

  // section 补读结果同时校验项目 path、epoch 和 section revision，避免旧工程或旧版本覆盖后端新事实镜像。
  const should_apply_project_change_for_identity = useCallback(
    (
      identity: Pick<RuntimeProjectIdentity, "path" | "epoch">,
      change_event: ProjectStoreChangeEvent,
    ): boolean => {
      if (
        !is_current_runtime_project_identity(identity) ||
        change_event.projectPath !== identity.path
      ) {
        return false;
      }
      return should_apply_runtime_project_change(change_event);
    },
    [is_current_runtime_project_identity, should_apply_runtime_project_change],
  );

  const read_project_sections_for_change = useCallback(
    async (
      change_event: ProjectStoreChangeEvent,
      sections: ProjectStoreStage[],
    ): Promise<ProjectStoreChangeEvent | null> => {
      // section-invalidated 只能通过后端补读转回 canonical data，补读结果仍要重新过新鲜度闸门。
      const project_path = change_event.projectPath;
      const request_identity = read_runtime_project_identity();
      if (
        request_identity.path !== project_path ||
        !should_apply_project_change_for_identity(request_identity, change_event)
      ) {
        return null;
      }
      const read_sections_payload = await api_fetch<ProjectReadSectionsPayload>(
        "/api/project/read-sections",
        { sections },
      );
      const read_sections_event = normalize_project_read_sections_event(read_sections_payload);
      if (read_sections_event === null) {
        return null;
      }
      const canonical_event = {
        ...read_sections_event,
        eventId: change_event.eventId,
        source: change_event.source || "project_change",
      };
      const has_all_section_revisions = sections.every((section) => {
        return canonical_event.sectionRevisions?.[section] !== undefined;
      });
      if (!has_all_section_revisions) {
        return null;
      }
      return should_apply_project_change_for_identity(request_identity, canonical_event)
        ? canonical_event
        : null;
    },
    [read_runtime_project_identity, should_apply_project_change_for_identity],
  );

  const apply_project_change_event_immediately = useCallback(
    async (change_event: ProjectStoreChangeEvent): Promise<void> => {
      if (queue_runtime_project_change_during_warmup(change_event)) {
        return;
      }
      if (!should_apply_runtime_project_change(change_event)) {
        return;
      }

      flush_runtime_refresh_scheduler();
      const invalidated_sections = collect_project_change_sections_requiring_read(change_event);
      if (invalidated_sections.length > 0) {
        if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
          return;
        }
        const read_sections_event = await read_project_sections_for_change(
          change_event,
          invalidated_sections,
        );
        if (read_sections_event !== null) {
          apply_runtime_project_change(read_sections_event, "exact");
        }
        return;
      }

      apply_runtime_project_change(change_event);
    },
    [
      apply_runtime_project_change,
      flush_runtime_refresh_scheduler,
      project_snapshot.loaded,
      project_snapshot.path,
      queue_runtime_project_change_during_warmup,
      read_project_sections_for_change,
      should_apply_runtime_project_change,
    ],
  );

  const refresh_project_runtime = useCallback(async (): Promise<void> => {
    flush_runtime_refresh_scheduler();

    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      clear_runtime_project_identity();
      project_store_ref.current.reset();
      set_project_warmup_stage(null);
      return;
    }

    const warmup_identity = begin_runtime_project_warmup(project_snapshot.path.trim());
    set_project_warmup_status("warming");
    set_project_warmup_stage(null);
    const manifest = await api_fetch<ProjectManifestPayload>("/api/project/manifest", {});
    if (!is_current_runtime_project_warmup(warmup_identity)) {
      return;
    }

    const next_project_snapshot = normalize_project_snapshot({ project: manifest.project });
    const manifest_project_path = String(manifest.projectPath ?? "").trim();
    if (!next_project_snapshot.loaded || manifest_project_path === "") {
      sync_project_snapshot(next_project_snapshot);
      project_store_ref.current.reset();
      set_project_warmup_stage(null);
      return;
    }
    if (
      manifest_project_path !== next_project_snapshot.path ||
      manifest_project_path !== warmup_identity.path
    ) {
      throw new InternalInvariantError({
        diagnostic_context: {
          reason: "project_runtime_manifest_identity_mismatch",
          manifest_project_path,
          snapshot_project_path: next_project_snapshot.path,
          current_project_path: warmup_identity.path,
        },
      });
    }
    const read_sections_payload = await api_fetch<ProjectReadSectionsPayload>(
      "/api/project/read-sections",
      {
        sections: [...PROJECT_DATA_SECTIONS],
      },
    );
    if (!is_current_runtime_project_warmup(warmup_identity)) {
      return;
    }

    const read_sections_event = normalize_project_read_sections_event(read_sections_payload);
    if (read_sections_event === null || read_sections_event.projectPath !== manifest_project_path) {
      throw new InternalInvariantError({
        diagnostic_context: {
          reason: "project_runtime_sections_snapshot_unmergeable",
          manifest_project_path,
          read_sections_project_path: read_sections_event?.projectPath ?? "",
        },
      });
    }
    replace_runtime_project_data(read_sections_event);
    const queued_project_changes = complete_runtime_project_warmup(warmup_identity);
    sync_project_snapshot(next_project_snapshot);
    for (const queued_change of queued_project_changes) {
      await apply_project_change_event_immediately(queued_change);
    }
  }, [
    apply_project_change_event_immediately,
    begin_runtime_project_warmup,
    clear_runtime_project_identity,
    complete_runtime_project_warmup,
    flush_runtime_refresh_scheduler,
    is_current_runtime_project_warmup,
    project_snapshot.loaded,
    project_snapshot.path,
    replace_runtime_project_data,
    set_project_warmup_status,
    sync_project_snapshot,
  ]);

  const apply_project_mutation_result = useCallback(
    async (result: ProjectMutationResult): Promise<void> => {
      for (const change_event of result.changes) {
        await apply_project_change_event_immediately(change_event);
      }
    },
    [apply_project_change_event_immediately],
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
        sync_project_snapshot(normalize_project_snapshot(next_project));
        sync_task_snapshot(normalize_task_snapshot(next_task));
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
  }, [apply_settings_snapshot, sync_project_snapshot, sync_task_snapshot]);

  useEffect(() => {
    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      clear_runtime_project_identity();
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
  }, [
    clear_runtime_project_identity,
    project_snapshot.loaded,
    project_snapshot.path,
    refresh_project_runtime,
  ]);

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
      shouldApplyProjectChange: should_apply_runtime_project_change,
    });
    runtime_refresh_scheduler_ref.current = runtime_refresh_scheduler;

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
      if (queue_runtime_project_change_during_warmup(change_event)) {
        return;
      }
      if (!should_apply_runtime_project_change(change_event)) {
        return;
      }

      const invalidated_sections = collect_project_change_sections_requiring_read(change_event);
      if (invalidated_sections.length > 0) {
        runtime_refresh_scheduler.flush();
        if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
          return;
        }

        const read_sections_event = await read_project_sections_for_change(
          change_event,
          invalidated_sections,
        );
        if (cancelled) {
          return;
        }
        if (read_sections_event !== null) {
          apply_runtime_project_change(read_sections_event, "exact");
        }
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
    queue_runtime_project_change_during_warmup,
    read_project_sections_for_change,
    refresh_settings,
    refresh_project_runtime,
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
      set_project_warmup_status,
      set_pending_target_route,
      project_store: project_store_reader,
      apply_settings_snapshot,
      sync_task_snapshot,
      refresh_project_snapshot,
      refresh_project_runtime,
      apply_project_mutation_result,
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
    apply_settings_snapshot,
    apply_project_mutation_result,
    project_store_reader,
    refresh_project_snapshot,
    refresh_project_runtime,
    refresh_settings,
    refresh_task,
    sync_task_snapshot,
    update_app_language,
  ]);

  return (
    <DesktopRuntimeContext.Provider value={context_value}>
      {props.children}
    </DesktopRuntimeContext.Provider>
  );
}
