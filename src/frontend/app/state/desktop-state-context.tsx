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

import type { RouteId } from "@frontend/app/navigation/types";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectChangeApplyResult,
  type ProjectChangeEventForState,
  type ProjectStage,
} from "@frontend/app/state/desktop-project-change-types";
import {
  createTaskSnapshotStore,
  normalize_task_snapshot,
  type TaskSnapshot,
} from "@frontend/app/state/task-snapshot-store";
import type { DesktopRefreshScheduler } from "@frontend/app/state/desktop-refresh-scheduler";
import { useDesktopRecovery } from "@frontend/app/state/desktop-recovery";
import { useDesktopEventStream } from "@frontend/app/state/desktop-event-stream";
import {
  useProjectWriteCommitter,
  type ProjectWriteCommitter,
  type ProjectWriteResult,
} from "@frontend/app/state/desktop-project-write";
import { useProjectEventPipeline } from "@frontend/app/state/project-event-pipeline";
import { normalize_project_change_event } from "@frontend/app/state/desktop-project-change-normalizer";
import {
  normalize_setting_snapshot,
  type AppLanguage,
  type RecentProjectSetting,
  type SettingSnapshot,
} from "@domain/setting";
import type { TaskType } from "@domain/task";
import { PROJECT_DATA_SECTIONS } from "@shared/project-event";
import { InternalInvariantError } from "@shared/error";

type RecentProjectEntry = RecentProjectSetting;

export type SettingsSnapshot = SettingSnapshot;

export type ProjectSnapshot = {
  path: string;
  loaded: boolean;
};

export type ProjectChangeSignal = {
  seq: number;
  reason: string;
  updated_sections: ProjectStage[];
  results: ProjectChangeApplyResult[];
};

const APPLIED_PROJECT_EVENT_ID_LIMIT = 256; // 去重窗口只覆盖近期 HTTP/SSE 同源事件，避免长期保存事件历史

type ProjectSessionStatus = "idle" | "warming" | "ready";

type ProjectStateIdentity = {
  path: string; // 后端会话确认的当前项目路径，独立于可能滞后的页面 query
  epoch: number; // 每次项目切换或完整 session 初始化递增，用于丢弃迟到补读和旧快照
  phase: ProjectSessionStatus; // phase 只表示当前项目 query 刷新阶段，不等同于页面局部状态
};

// EMPTY PROJECT STATE IDENTITY 是默认快照事实，调用方只读取副本不临时拼装。
const EMPTY_PROJECT_STATE_IDENTITY: ProjectStateIdentity = {
  path: "",
  epoch: 0,
  phase: "idle",
};

type DesktopStateContextValue = {
  initial_state_ready: boolean;
  initial_state_error: string | null;
  settings_snapshot: SettingsSnapshot;
  project_snapshot: ProjectSnapshot;
  task_snapshot: TaskSnapshot;
  project_change_signal: ProjectChangeSignal;
  project_session_status: ProjectSessionStatus;
  project_session_stage: ProjectStage | null;
  pending_target_route: RouteId | null;
  is_app_language_updating: boolean;
  set_project_session_status: (status: ProjectSessionStatus) => void;
  set_pending_target_route: (route_id: RouteId | null) => void;
  apply_settings_snapshot: (payload: SettingsSnapshotPayload) => SettingsSnapshot;
  sync_task_snapshot: (snapshot: TaskSnapshot) => void;
  refresh_project_snapshot: () => Promise<ProjectSnapshot>;
  refresh_project_state: () => Promise<void>;
  commit_project_write: ProjectWriteCommitter;
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

type ProjectManifestPayload = {
  projectPath?: unknown;
  project?: Partial<ProjectSnapshot>;
  projectRevision?: unknown;
  sectionRevisions?: unknown;
};

// DEFAULT PROJECT SNAPSHOT 是默认快照事实，调用方只读取副本不临时拼装。
const DEFAULT_PROJECT_SNAPSHOT: ProjectSnapshot = {
  path: "",
  loaded: false,
};

// DEFAULT PROJECT CHANGE SIGNAL 是默认快照事实，调用方只读取副本不临时拼装。
const DEFAULT_PROJECT_CHANGE_SIGNAL: ProjectChangeSignal = {
  seq: 0,
  reason: "",
  updated_sections: [],
  results: [],
};

// Desktop Runtime Context 是模块级稳定契约，集中维护避免调用点散落魔术值。
/**
 * 集中维护当前模块的稳定常量。
 */
export const DesktopStateContext = createContext<DesktopStateContextValue | null>(null);

// normalize_settings_snapshot 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
export function normalize_settings_snapshot(payload: SettingsSnapshotPayload): SettingsSnapshot {
  return normalize_setting_snapshot(payload.settings);
}

// normalize_project_snapshot 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  const snapshot = payload.project ?? {};
  return {
    path: String(snapshot.path ?? ""),
    loaded: Boolean(snapshot.loaded),
  };
}

// collect_project_apply_result_sections 封装当前模块的共享逻辑，避免重复实现同一维护规则。
/**
 * 读取当前场景需要的稳定数据。
 */
function collect_project_apply_result_sections(
  results: readonly ProjectChangeApplyResult[],
): ProjectStage[] {
  return [...new Set(results.flatMap((result) => result.updatedSections))];
}

// resolve_project_apply_result_reason 集中解析运行时决策，避免调用点复制条件判断。
/**
 * 解析当前场景的最终消费值。
 */
function resolve_project_apply_result_reason(results: readonly ProjectChangeApplyResult[]): string {
  const reasons = [...new Set(results.map((result) => result.source || "project_change"))];
  return reasons.length === 1 ? (reasons[0] ?? "project_change") : "project_change_batch";
}

/**
 * 构造当前场景的标准初始数据。
 */
function create_project_change_apply_result(
  event: ProjectChangeEventForState,
): ProjectChangeApplyResult {
  const upsert_item_ids = new Set<number | string>();
  const delete_item_ids = new Set<number | string>();
  const upsert_file_paths = new Set<string>();
  const delete_file_paths = new Set<string>();
  let item_full_replace = false;
  let file_full_replace = false;
  let field_patch: ProjectChangeApplyResult["itemDelta"] extends infer T
    ? T extends { fieldPatch?: infer P }
      ? P | undefined
      : never
    : never;

  for (const operation of event.operations) {
    if (operation.items !== undefined) {
      if (operation.items.payloadMode === "section-invalidated") {
        item_full_replace = true;
      }
      for (const item_id of Object.keys(operation.items.upsert ?? {})) {
        upsert_item_ids.add(Number(item_id));
      }
      for (const item_id of operation.items.changedIds ?? []) {
        upsert_item_ids.add(item_id);
      }
      for (const item_id of operation.items.deleteIds ?? []) {
        delete_item_ids.add(item_id);
      }
      if (operation.items.fieldPatch !== undefined) {
        field_patch = { ...operation.items.fieldPatch };
      }
    }
    if (operation.files !== undefined) {
      if (operation.files.payloadMode === "section-invalidated") {
        file_full_replace = true;
      }
      for (const file_path of Object.keys(operation.files.upsert ?? {})) {
        upsert_file_paths.add(file_path);
      }
      for (const file_path of operation.files.changedPaths ?? []) {
        upsert_file_paths.add(file_path);
      }
      for (const file_path of operation.files.deletePaths ?? []) {
        delete_file_paths.add(file_path);
      }
    }
  }

  const result: ProjectChangeApplyResult = {
    applied: true,
    eventId: event.eventId,
    source: event.source,
    projectRevision: event.projectRevision,
    updatedSections: [...event.updatedSections],
    sectionRevisions: { ...event.sectionRevisions },
  };
  if (upsert_item_ids.size > 0 || delete_item_ids.size > 0 || item_full_replace) {
    const item_delta: NonNullable<ProjectChangeApplyResult["itemDelta"]> = {
      upsertItemIds: [...upsert_item_ids],
      deleteItemIds: [...delete_item_ids],
      fullReplace: item_full_replace,
    };
    if (field_patch !== undefined) {
      item_delta.fieldPatch = field_patch;
    }
    result.itemDelta = item_delta;
  }
  if (upsert_file_paths.size > 0 || delete_file_paths.size > 0 || file_full_replace) {
    result.fileDelta = {
      upsertFilePaths: [...upsert_file_paths],
      deleteFilePaths: [...delete_file_paths],
      fullReplace: file_full_replace,
    };
  }
  return result;
}

// DesktopStateProvider 封装当前模块的共享逻辑，避免重复实现同一维护规则。
/**
 * 渲染当前组件的公开界面。
 */
export function DesktopStateProvider(props: { children: ReactNode }): JSX.Element {
  const [initial_state_ready, set_initial_state_ready] = useState(false);
  const [initial_state_error, set_initial_state_error] = useState<string | null>(null);
  const [settings_snapshot, write_settings_snapshot] = useState<SettingsSnapshot>(() =>
    normalize_settings_snapshot({}),
  );
  const [project_snapshot, write_project_snapshot] =
    useState<ProjectSnapshot>(DEFAULT_PROJECT_SNAPSHOT);
  const task_snapshot_store_ref = useRef(createTaskSnapshotStore());
  const task_snapshot = useSyncExternalStore(
    task_snapshot_store_ref.current.subscribe,
    task_snapshot_store_ref.current.getSnapshot,
  );
  const sync_task_snapshot = useCallback((snapshot: TaskSnapshot): void => {
    task_snapshot_store_ref.current.applySnapshot(snapshot);
  }, []);
  const [project_change_signal, set_project_change_signal] = useState<ProjectChangeSignal>(
    DEFAULT_PROJECT_CHANGE_SIGNAL,
  );
  const [project_session_status, set_project_session_status] =
    useState<ProjectSessionStatus>("idle");
  const [project_session_stage, set_project_session_stage] = useState<ProjectStage | null>(null);
  const [pending_target_route, set_pending_target_route] = useState<RouteId | null>(null);
  const [is_app_language_updating, set_is_app_language_updating] = useState(false);
  const refresh_scheduler_ref = useRef<DesktopRefreshScheduler | null>(null); // 本地操作和项目刷新通过 ref 先冲刷 SSE pending 队列
  const applied_project_event_ids_ref = useRef<Set<string>>(new Set());
  const applied_project_event_id_order_ref = useRef<string[]>([]);
  const project_state_identity_ref = useRef<ProjectStateIdentity>({
    ...EMPTY_PROJECT_STATE_IDENTITY,
  });
  const pending_session_project_changes_ref = useRef<ProjectChangeEventForState[]>([]); // 当前项目 query 首刷完成前暂存事件，避免 session 初始化窗口漏同步

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

  const flush_refresh_scheduler = useCallback((): void => {
    refresh_scheduler_ref.current?.flush();
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

  const read_project_state_identity = useCallback((): ProjectStateIdentity => {
    return project_state_identity_ref.current;
  }, []);

  const is_current_project_state_identity = useCallback(
    (identity: Pick<ProjectStateIdentity, "path" | "epoch">): boolean => {
      const current_identity = read_project_state_identity();
      return (
        identity.path !== "" &&
        current_identity.path === identity.path &&
        current_identity.epoch === identity.epoch
      );
    },
    [read_project_state_identity],
  );

  const is_current_project_session_warming = useCallback(
    (identity: Pick<ProjectStateIdentity, "path" | "epoch">): boolean => {
      const current_identity = read_project_state_identity();
      return is_current_project_state_identity(identity) && current_identity.phase === "warming";
    },
    [is_current_project_state_identity, read_project_state_identity],
  );

  const clear_project_state_identity = useCallback((): void => {
    project_state_identity_ref.current = {
      path: "",
      epoch: project_state_identity_ref.current.epoch + 1,
      phase: "idle",
    };
    pending_session_project_changes_ref.current = [];
    clear_applied_project_events();
  }, [clear_applied_project_events]);

  const begin_project_state_session = useCallback(
    (project_path: string): ProjectStateIdentity => {
      const current_identity = project_state_identity_ref.current;
      if (current_identity.path === project_path && current_identity.phase === "warming") {
        return current_identity;
      }

      const next_identity: ProjectStateIdentity = {
        path: project_path,
        epoch: current_identity.epoch + 1,
        phase: "warming",
      };
      project_state_identity_ref.current = next_identity;
      pending_session_project_changes_ref.current = [];
      if (current_identity.path !== project_path) {
        clear_applied_project_events();
      }
      return next_identity;
    },
    [clear_applied_project_events],
  );

  const complete_project_state_session = useCallback(
    (identity: ProjectStateIdentity): ProjectChangeEventForState[] => {
      if (!is_current_project_state_identity(identity)) {
        return [];
      }

      project_state_identity_ref.current = {
        ...identity,
        phase: "ready",
      };
      const queued_changes = pending_session_project_changes_ref.current;
      pending_session_project_changes_ref.current = [];
      return queued_changes;
    },
    [is_current_project_state_identity],
  );

  const queue_project_state_change_during_session_warming = useCallback(
    (change_event: ProjectChangeEventForState): boolean => {
      if (has_applied_project_event(change_event.eventId)) {
        return true;
      }

      const current_identity = read_project_state_identity();
      if (
        current_identity.phase !== "warming" ||
        current_identity.path === "" ||
        change_event.projectPath !== current_identity.path
      ) {
        return false;
      }

      pending_session_project_changes_ref.current.push(change_event);
      return true;
    },
    [has_applied_project_event, read_project_state_identity],
  );

  const sync_project_snapshot = useCallback(
    (snapshot: ProjectSnapshot): void => {
      write_project_snapshot(snapshot);
      const project_path = snapshot.loaded ? snapshot.path.trim() : "";
      if (project_path === "") {
        clear_project_state_identity();
        return;
      }

      const current_identity = project_state_identity_ref.current;
      if (current_identity.path !== project_path || current_identity.phase === "idle") {
        begin_project_state_session(project_path);
      }
    },
    [begin_project_state_session, clear_project_state_identity],
  );

  const refresh_project_snapshot = useCallback(async (): Promise<ProjectSnapshot> => {
    const payload = await api_fetch<ProjectSnapshotPayload>("/api/session/project/snapshot", {});
    const next_snapshot = normalize_project_snapshot(payload);
    sync_project_snapshot(next_snapshot);
    return next_snapshot;
  }, [sync_project_snapshot]);

  // 任务页主动刷新时要绑定任务类型；全局初始状态读取才允许交给后端推断当前快照类型
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

  // 页面只消费轻量项目变更信号，具体事实由各页面后端 query 读取。
  const publish_project_change_results = useCallback(
    (results: readonly ProjectChangeApplyResult[]): void => {
      const applied_results = results.filter((result) => result.applied);
      if (applied_results.length === 0) {
        return;
      }

      set_project_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: resolve_project_apply_result_reason(applied_results),
        updated_sections: collect_project_apply_result_sections(applied_results),
        results: applied_results.map((result) => ({
          ...result,
          updatedSections: [...result.updatedSections],
          sectionRevisions: { ...result.sectionRevisions },
          ...(result.itemDelta === undefined
            ? {}
            : {
                itemDelta: {
                  ...result.itemDelta,
                  upsertItemIds: [...result.itemDelta.upsertItemIds],
                  deleteItemIds: [...result.itemDelta.deleteItemIds],
                  ...(result.itemDelta.fieldPatch === undefined
                    ? {}
                    : { fieldPatch: { ...result.itemDelta.fieldPatch } }),
                },
              }),
          ...(result.fileDelta === undefined
            ? {}
            : {
                fileDelta: {
                  ...result.fileDelta,
                  upsertFilePaths: [...result.fileDelta.upsertFilePaths],
                  deleteFilePaths: [...result.fileDelta.deleteFilePaths],
                },
              }),
        })),
      }));
    },
    [],
  );

  const apply_project_state_change = useCallback(
    (change_event: ProjectChangeEventForState): void => {
      const apply_result = create_project_change_apply_result(change_event);
      mark_project_event_applied(change_event.eventId);
      publish_project_change_results([apply_result]);
    },
    [mark_project_event_applied, publish_project_change_results],
  );

  const apply_project_state_change_batch = useCallback(
    (change_events: readonly ProjectChangeEventForState[]): void => {
      if (change_events.length === 0) {
        return;
      }

      const apply_results = change_events.map(create_project_change_apply_result);
      for (const change_event of change_events) {
        mark_project_event_applied(change_event.eventId);
      }
      publish_project_change_results(apply_results);
    },
    [mark_project_event_applied, publish_project_change_results],
  );

  const should_apply_project_state_change = useCallback(
    (change_event: ProjectChangeEventForState): boolean => {
      if (has_applied_project_event(change_event.eventId)) {
        return false;
      }

      const current_identity = read_project_state_identity();
      if (
        current_identity.phase !== "ready" ||
        current_identity.path === "" ||
        change_event.projectPath !== current_identity.path
      ) {
        return false;
      }

      return true;
    },
    [has_applied_project_event, read_project_state_identity],
  );

  const apply_project_change_event_immediately = useCallback(
    async (change_event: ProjectChangeEventForState): Promise<void> => {
      if (queue_project_state_change_during_session_warming(change_event)) {
        return;
      }
      if (!should_apply_project_state_change(change_event)) {
        return;
      }

      flush_refresh_scheduler();
      apply_project_state_change(change_event);
    },
    [
      apply_project_state_change,
      flush_refresh_scheduler,
      queue_project_state_change_during_session_warming,
      should_apply_project_state_change,
    ],
  );

  const refresh_project_state = useCallback(async (): Promise<void> => {
    flush_refresh_scheduler();

    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      clear_project_state_identity();
      set_project_session_stage(null);
      set_project_session_status("idle");
      return;
    }

    const session_identity = begin_project_state_session(project_snapshot.path.trim());
    set_project_session_status("warming");
    set_project_session_stage(null);
    const manifest = await api_fetch<ProjectManifestPayload>("/api/session/project/manifest", {});
    if (!is_current_project_session_warming(session_identity)) {
      return;
    }

    const next_project_snapshot = normalize_project_snapshot({ project: manifest.project });
    const manifest_project_path = String(manifest.projectPath ?? "").trim();
    if (!next_project_snapshot.loaded || manifest_project_path === "") {
      sync_project_snapshot(next_project_snapshot);
      set_project_session_stage(null);
      set_project_session_status("idle");
      return;
    }
    if (
      manifest_project_path !== next_project_snapshot.path ||
      manifest_project_path !== session_identity.path
    ) {
      throw new InternalInvariantError({
        diagnostic_context: {
          reason: "project_state_manifest_identity_mismatch",
          manifest_project_path,
          snapshot_project_path: next_project_snapshot.path,
          current_project_path: session_identity.path,
        },
      });
    }
    const queued_project_changes = complete_project_state_session(session_identity);
    sync_project_snapshot(next_project_snapshot);
    publish_project_change_results([
      {
        applied: true,
        source: "project_loaded",
        projectRevision: Number(manifest.projectRevision ?? 0),
        updatedSections: [...PROJECT_DATA_SECTIONS],
        sectionRevisions:
          typeof manifest.sectionRevisions === "object" &&
          manifest.sectionRevisions !== null &&
          !Array.isArray(manifest.sectionRevisions)
            ? (manifest.sectionRevisions as ProjectChangeApplyResult["sectionRevisions"])
            : {},
      },
    ]);
    for (const queued_change of queued_project_changes) {
      await apply_project_change_event_immediately(queued_change);
    }
    set_project_session_status("ready");
  }, [
    apply_project_change_event_immediately,
    begin_project_state_session,
    clear_project_state_identity,
    complete_project_state_session,
    flush_refresh_scheduler,
    is_current_project_session_warming,
    project_snapshot.loaded,
    project_snapshot.path,
    publish_project_change_results,
    set_project_session_status,
    sync_project_snapshot,
  ]);

  const { report_state_error, refresh_task_after_state_error, refresh_project_state_after_error } =
    useDesktopRecovery({
      project_loaded: project_snapshot.loaded,
      project_path: project_snapshot.path,
      refresh_project_state,
      refresh_task,
    });

  // HTTP 写入结果与 SSE 共用同一项目事件入口，保持事件顺序和去重语义一致。
  const apply_project_write_changes = useCallback(
    async (result: ProjectWriteResult): Promise<void> => {
      for (const change_event of result.changes) {
        await apply_project_change_event_immediately(change_event);
      }
    },
    [apply_project_change_event_immediately],
  );

  const commit_project_write = useProjectWriteCommitter({
    applyProjectWriteChanges: apply_project_write_changes,
    recovery: {
      report_state_error,
      refresh_project_state_after_error,
    },
  });

  useEffect(() => {
    let cancelled = false;

    // load_initial_state 封装当前模块的共享逻辑，避免重复实现同一维护规则。
    /**
     * 承接当前模块的核心控制分支。
     */
    async function load_initial_state(): Promise<void> {
      try {
        // Backend API 状态是共享权威源，渲染层启动或热更新时不能通过卸载工程去“重置会话”，否则开发态的 StrictMode、Fast Refresh 或整页重载都会把外部手动打开的旧应用状态一起清空
        const [next_settings, next_project, next_task] = await Promise.all([
          api_fetch<SettingsSnapshotPayload>("/api/settings/app", {}),
          api_fetch<ProjectSnapshotPayload>("/api/session/project/snapshot", {}),
          api_fetch<TaskSnapshotPayload>("/api/tasks/snapshot", {}),
        ]);
        if (cancelled) {
          return;
        }

        apply_settings_snapshot(next_settings);
        sync_project_snapshot(normalize_project_snapshot(next_project));
        sync_task_snapshot(normalize_task_snapshot(next_task));
        set_initial_state_error(null);
        set_initial_state_ready(true);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "桌面运行时初始化失败。";
        report_state_error(error, {
          source: "state-recovery",
          context: { stage: "load_initial_state" },
        });
        set_initial_state_error(message);
        set_initial_state_ready(true);
      }
    }

    void load_initial_state();

    return () => {
      cancelled = true;
    };
  }, [apply_settings_snapshot, report_state_error, sync_project_snapshot, sync_task_snapshot]);

  useEffect(() => {
    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      clear_project_state_identity();
      set_project_session_stage(null);
      return;
    }

    let cancelled = false;

    // refresh_loaded_project_state 封装当前模块的共享逻辑，避免重复实现同一维护规则。
    /**
     * 承接当前模块的核心控制分支。
     */
    async function refresh_loaded_project_state(): Promise<void> {
      try {
        await refresh_project_state();
      } catch (error) {
        report_state_error(error, {
          source: "state-recovery",
          context: { stage: "refresh_loaded_project_state" },
        });
        return;
      }

      if (cancelled) {
        return;
      }
    }

    void refresh_loaded_project_state();

    return () => {
      cancelled = true;
    };
  }, [
    clear_project_state_identity,
    project_snapshot.loaded,
    project_snapshot.path,
    refresh_project_state,
    report_state_error,
  ]);

  useEffect(() => {
    if (project_session_status === "ready") {
      set_project_session_stage(null);
    }
  }, [project_session_status]);

  const project_event_pipeline = useProjectEventPipeline({
    projectSnapshot: project_snapshot,
    applyProjectChangeBatch: apply_project_state_change_batch,
    shouldApplyProjectChange: should_apply_project_state_change,
    queueProjectChangeDuringSessionWarming: queue_project_state_change_during_session_warming,
    normalizeProjectChangeEvent: normalize_project_change_event,
    recovery: {
      report_state_error,
      refresh_project_state_after_error,
    },
  });

  useDesktopEventStream({
    schedulerRef: refresh_scheduler_ref,
    applySettingsSnapshot: apply_settings_snapshot,
    applyTaskSnapshot: sync_task_snapshot,
    refreshSettings: refresh_settings,
    projectEvents: project_event_pipeline,
    recovery: {
      report_state_error,
      refresh_project_state_after_error,
      refresh_task_after_state_error,
    },
  });

  const context_value = useMemo<DesktopStateContextValue>(() => {
    return {
      initial_state_ready,
      initial_state_error,
      settings_snapshot,
      project_snapshot,
      task_snapshot,
      project_change_signal,
      project_session_status,
      project_session_stage,
      pending_target_route,
      is_app_language_updating,
      set_project_session_status,
      set_pending_target_route,
      apply_settings_snapshot,
      sync_task_snapshot,
      refresh_project_snapshot,
      refresh_project_state,
      commit_project_write,
      update_app_language,
      refresh_settings,
      refresh_task,
    };
  }, [
    initial_state_ready,
    initial_state_error,
    settings_snapshot,
    project_snapshot,
    task_snapshot,
    project_change_signal,
    project_session_status,
    project_session_stage,
    pending_target_route,
    is_app_language_updating,
    apply_settings_snapshot,
    commit_project_write,
    refresh_project_snapshot,
    refresh_project_state,
    refresh_settings,
    refresh_task,
    sync_task_snapshot,
    update_app_language,
  ]);

  return (
    <DesktopStateContext.Provider value={context_value}>
      {props.children}
    </DesktopStateContext.Provider>
  );
}
