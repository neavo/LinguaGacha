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
import { api_fetch } from "@/app/desktop/desktop-api";
import {
  createProjectStore,
  isProjectStoreStage,
  type ProjectStoreChangeApplyResult,
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
import type { DesktopRuntimeRefreshScheduler } from "@/app/desktop/desktop-runtime-refresh-scheduler";
import { useDesktopRuntimeRecovery } from "@/app/desktop/desktop-runtime-recovery";
import { useDesktopRuntimeEventStream } from "@/app/desktop/desktop-runtime-event-stream";
import {
  useProjectMutationCommitter,
  type ProjectMutationCommitter,
  type ProjectMutationResult,
} from "@/app/desktop/desktop-project-mutation";
import { useDesktopRuntimeProjectEventPipeline } from "@/app/desktop/desktop-runtime-project-event-pipeline";
import {
  normalize_project_change_event,
  normalize_project_read_sections_event,
  type ProjectReadSectionsPayload,
} from "@/app/desktop/desktop-project-change-normalizer";
import {
  normalize_setting_snapshot,
  type AppLanguage,
  type RecentProjectSetting,
  type SettingSnapshot,
} from "@base/setting";
import type { TaskType } from "@shared/task";
import { PROJECT_DATA_SECTIONS } from "@shared/project/event";
import { InternalInvariantError } from "@shared/error";

type RecentProjectEntry = RecentProjectSetting;

export type SettingsSnapshot = SettingSnapshot;

export type ProjectSnapshot = {
  path: string;
  loaded: boolean;
};

export type ProjectRuntimeChangeSignal = {
  seq: number;
  reason: string;
  updated_sections: ProjectStoreStage[];
  results: ProjectStoreChangeApplyResult[];
};

const APPLIED_PROJECT_EVENT_ID_LIMIT = 256; // 去重窗口只覆盖近期 HTTP/SSE 同源事件，避免长期保存事件历史

type ProjectWarmupStatus = "idle" | "warming" | "ready";

type RuntimeProjectIdentity = {
  path: string; // 后端会话确认的当前项目路径，独立于可能滞后的 ProjectStore 镜像
  epoch: number; // 每次项目切换或完整 warmup 递增，用于丢弃迟到补读和旧快照
  phase: ProjectWarmupStatus; // 这里只表示 ProjectStore 初始化阶段，不等同于页面缓存 warmup 状态
};

// EMPTY RUNTIME PROJECT IDENTITY 是默认快照事实，调用方只读取副本不临时拼装。
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
  project_change_signal: ProjectRuntimeChangeSignal;
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
  commit_project_mutation: ProjectMutationCommitter;
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
const DEFAULT_PROJECT_CHANGE_SIGNAL: ProjectRuntimeChangeSignal = {
  seq: 0,
  reason: "",
  updated_sections: [],
  results: [],
};

// Desktop Runtime Context 是模块级稳定契约，集中维护避免调用点散落魔术值。
export const DesktopRuntimeContext = createContext<DesktopRuntimeContextValue | null>(null);

// normalize_settings_snapshot 在边界处归一化输入，避免下游再处理坏载荷分支。
export function normalize_settings_snapshot(payload: SettingsSnapshotPayload): SettingsSnapshot {
  return normalize_setting_snapshot(payload.settings);
}

// normalize_project_snapshot 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  const snapshot = payload.project ?? {};
  return {
    path: String(snapshot.path ?? ""),
    loaded: Boolean(snapshot.loaded),
  };
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

// collect_project_apply_result_sections 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function collect_project_apply_result_sections(
  results: readonly ProjectStoreChangeApplyResult[],
): ProjectStoreStage[] {
  return [...new Set(results.flatMap((result) => result.updatedSections))];
}

// resolve_project_apply_result_reason 集中解析运行时决策，避免调用点复制条件判断。
function resolve_project_apply_result_reason(
  results: readonly ProjectStoreChangeApplyResult[],
): string {
  const reasons = [...new Set(results.map((result) => result.source || "project_change"))];
  return reasons.length === 1 ? (reasons[0] ?? "project_change") : "project_change_batch";
}

// DesktopRuntimeProvider 封装当前模块的共享逻辑，避免重复实现同一维护规则。
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
  const [project_change_signal, set_project_change_signal] = useState<ProjectRuntimeChangeSignal>(
    DEFAULT_PROJECT_CHANGE_SIGNAL,
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

  // 页面缓存只消费 ProjectStore 的标准应用结果，避免事件流或 Provider 内登记页面分支。
  const publish_project_change_results = useCallback(
    (results: readonly ProjectStoreChangeApplyResult[]): void => {
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

  const apply_runtime_project_change = useCallback(
    (
      change_event: ProjectStoreChangeEvent,
      revision_mode: ProjectStoreChangeRevisionMode = "merge",
    ): void => {
      const apply_result = project_store_ref.current.applyProjectChange(change_event, {
        revisionMode: revision_mode,
      });
      mark_project_event_applied(change_event.eventId);
      publish_project_change_results([apply_result]);
    },
    [mark_project_event_applied, publish_project_change_results],
  );

  const apply_runtime_project_change_batch = useCallback(
    (change_events: readonly ProjectStoreChangeEvent[]): void => {
      if (change_events.length === 0) {
        return;
      }

      // 同一刷新窗口内 project 事实只写一次 store，再发布标准应用结果给页面缓存。
      const apply_results = project_store_ref.current.applyProjectChangeBatch(change_events);
      for (const change_event of change_events) {
        mark_project_event_applied(change_event.eventId);
      }
      publish_project_change_results(apply_results);
    },
    [mark_project_event_applied, publish_project_change_results],
  );

  const replace_runtime_project_data = useCallback(
    (change_event: ProjectStoreChangeEvent): void => {
      // 初始化快照绕过增量合并，从空态一次替换，再发布同一类标准应用结果。
      const apply_result = project_store_ref.current.replaceProjectData(change_event);
      mark_project_event_applied(change_event.eventId);
      publish_project_change_results([apply_result]);
    },
    [mark_project_event_applied, publish_project_change_results],
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

  const {
    report_runtime_error,
    refresh_task_after_runtime_error,
    refresh_project_runtime_after_error,
  } = useDesktopRuntimeRecovery({
    project_loaded: project_snapshot.loaded,
    project_path: project_snapshot.path,
    refresh_project_runtime,
    refresh_task,
  });

  // HTTP mutation result 与 SSE 共用同一 ProjectStore 应用路径，保持事件顺序和去重语义一致。
  const apply_project_mutation_changes = useCallback(
    async (result: ProjectMutationResult): Promise<void> => {
      for (const change_event of result.changes) {
        await apply_project_change_event_immediately(change_event);
      }
    },
    [apply_project_change_event_immediately],
  );

  const commit_project_mutation = useProjectMutationCommitter({
    applyProjectMutationChanges: apply_project_mutation_changes,
    recovery: {
      report_runtime_error,
      refresh_project_runtime_after_error,
    },
  });

  useEffect(() => {
    let cancelled = false;

    // hydrate_runtime 封装当前模块的共享逻辑，避免重复实现同一维护规则。
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
        report_runtime_error(error, {
          source: "runtime-recovery",
          context: { stage: "hydrate_runtime" },
        });
        set_hydration_error(message);
        set_hydration_ready(true);
      }
    }

    void hydrate_runtime();

    return () => {
      cancelled = true;
    };
  }, [apply_settings_snapshot, report_runtime_error, sync_project_snapshot, sync_task_snapshot]);

  useEffect(() => {
    if (!project_snapshot.loaded || project_snapshot.path.trim() === "") {
      clear_runtime_project_identity();
      project_store_ref.current.reset();
      set_project_warmup_stage(null);
      return;
    }

    let cancelled = false;

    // refresh_loaded_project_runtime 封装当前模块的共享逻辑，避免重复实现同一维护规则。
    async function refresh_loaded_project_runtime(): Promise<void> {
      try {
        await refresh_project_runtime();
      } catch (error) {
        report_runtime_error(error, {
          source: "runtime-recovery",
          context: { stage: "refresh_loaded_project_runtime" },
        });
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
    report_runtime_error,
  ]);

  useEffect(() => {
    if (project_warmup_status === "ready") {
      set_project_warmup_stage(null);
    }
  }, [project_warmup_status]);

  const project_event_pipeline = useDesktopRuntimeProjectEventPipeline({
    projectSnapshot: project_snapshot,
    applyProjectChange: apply_runtime_project_change,
    applyProjectChangeBatch: apply_runtime_project_change_batch,
    shouldApplyProjectChange: should_apply_runtime_project_change,
    queueProjectChangeDuringWarmup: queue_runtime_project_change_during_warmup,
    normalizeProjectChangeEvent: normalize_project_change_event,
    collectProjectChangeSectionsRequiringRead: collect_project_change_sections_requiring_read,
    readProjectSectionsForChange: read_project_sections_for_change,
    recovery: {
      report_runtime_error,
      refresh_project_runtime_after_error,
    },
  });

  useDesktopRuntimeEventStream({
    schedulerRef: runtime_refresh_scheduler_ref,
    applySettingsSnapshot: apply_settings_snapshot,
    applyTaskSnapshot: sync_task_snapshot,
    refreshSettings: refresh_settings,
    projectEvents: project_event_pipeline,
    recovery: {
      report_runtime_error,
      refresh_project_runtime_after_error,
      refresh_task_after_runtime_error,
    },
  });

  const context_value = useMemo<DesktopRuntimeContextValue>(() => {
    return {
      hydration_ready,
      hydration_error,
      settings_snapshot,
      project_snapshot,
      task_snapshot,
      project_change_signal,
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
      commit_project_mutation,
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
    project_change_signal,
    project_warmup_status,
    project_warmup_stage,
    pending_target_route,
    is_app_language_updating,
    apply_settings_snapshot,
    commit_project_mutation,
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
