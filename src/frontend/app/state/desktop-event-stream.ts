import { useEffect, type MutableRefObject } from "react";

import { open_event_stream } from "@frontend/app/desktop/desktop-api";
import {
  DesktopRefreshScheduler,
  type DesktopRefreshSchedulerErrorContext,
} from "@frontend/app/state/desktop-refresh-scheduler";
import {
  summarize_project_change_payload_for_diagnostics,
  summarize_scheduler_error_context,
  summarize_task_snapshot_for_diagnostics,
} from "@frontend/app/state/desktop-diagnostics";
import type { DesktopRecoveryActions } from "@frontend/app/state/desktop-recovery";
import type {
  ProjectEventPipeline,
  ProjectChangeEventPayload,
} from "@frontend/app/state/project-event-pipeline";
import {
  normalize_task_snapshot,
  type TaskSnapshot,
} from "@frontend/app/state/task-snapshot-store";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { record_renderer_diagnostics_event } from "@frontend/app/diagnostics/renderer-error-reporter";
import { parse_event_payload } from "@frontend/app/state/desktop-event-payload";
import { PROJECT_CHANGE_EVENT_TOPIC } from "@shared/project-event";
import { is_task_type } from "@domain/task";

type SettingsChangedEventPayload = {
  keys?: unknown;
  settings?: SettingsSnapshotPayload["settings"];
};

type DesktopEventStreamOptions = {
  schedulerRef: MutableRefObject<DesktopRefreshScheduler | null>;
  applySettingsSnapshot: (payload: SettingsSnapshotPayload) => void;
  applyTaskSnapshot: (snapshot: TaskSnapshot) => void;
  refreshSettings: () => Promise<unknown>;
  projectEvents: ProjectEventPipeline;
  recovery: DesktopRecoveryActions;
};

/**
 * Backend SSE 消费、调度器 flush 和异常恢复集中在事件流 hook，Provider 只负责注入 store 写入口。
 */
export function useDesktopEventStream(options: DesktopEventStreamOptions): void {
  const {
    schedulerRef,
    applySettingsSnapshot,
    applyTaskSnapshot,
    refreshSettings,
    projectEvents,
    recovery,
  } = options;
  const { report_state_error, refresh_project_state_after_error, refresh_task_after_state_error } =
    recovery;

  useEffect(() => {
    let event_source: EventSource | null = null;
    let cancelled = false;
    const refresh_scheduler = new DesktopRefreshScheduler({
      applyTaskSnapshot: applyTaskSnapshot,
      applyProjectChangeBatch: projectEvents.applyProjectChangeBatch,
      shouldApplyProjectChange: projectEvents.shouldApplyProjectChange,
      onFlushError: (error, context) => {
        handle_scheduler_flush_error(error, context, {
          report_state_error,
          refresh_project_state_after_error,
          refresh_task_after_state_error,
        });
      },
    });
    schedulerRef.current = refresh_scheduler;

    // handle_task_snapshot_changed 是事件处理边界，只把外部事件转换为本模块状态更新。
    /**
     * 承接当前模块的核心控制分支。
     */
    function handle_task_snapshot_changed(event: MessageEvent<string>): void {
      let payload: Record<string, unknown> = {};
      try {
        payload = parse_event_payload(event);
        const task_snapshot = normalize_task_snapshot(payload);
        // task 面包屑先于调度分支记录，保证崩溃发生在 enqueue/flush 之间时仍有最新进度。
        record_renderer_diagnostics_event({
          topic: "task.snapshot_changed",
          task: summarize_task_snapshot_for_diagnostics(task_snapshot),
        });
        if (should_apply_task_snapshot_immediately(task_snapshot)) {
          refresh_scheduler.flush();
          applyTaskSnapshot(task_snapshot);
          return;
        }

        refresh_scheduler.enqueue_task_snapshot(task_snapshot);
      } catch (error) {
        report_state_error(error, {
          source: "sse",
          triggeringEvent: {
            topic: "task.snapshot_changed",
            task: payload,
          },
          context: { stage: "handle_task_snapshot_changed" },
        });
        void refresh_task_after_state_error("task_snapshot_event_failed", {
          topic: "task.snapshot_changed",
        });
      }
    }

    // handle_settings_changed 是事件处理边界，只把外部事件转换为本模块状态更新。
    /**
     * 承接当前模块的核心控制分支。
     */
    function handle_settings_changed(event: MessageEvent<string>): void {
      let payload: SettingsChangedEventPayload = {};
      try {
        payload = parse_event_payload(event) as SettingsChangedEventPayload;

        if (typeof payload.settings === "object" && payload.settings !== null) {
          applySettingsSnapshot({
            settings: payload.settings,
          });
        } else {
          void refreshSettings().catch((error: unknown) => {
            report_state_error(error, {
              source: "settings",
              triggeringEvent: { topic: "settings.changed" },
              context: { stage: "refresh_settings_after_event" },
            });
          });
        }
      } catch (error) {
        report_state_error(error, {
          source: "settings",
          triggeringEvent: { topic: "settings.changed", keys: payload.keys },
          context: { stage: "handle_settings_changed" },
        });
      }
    }

    // handle_project_data_changed 是事件处理边界，只把外部事件转换为本模块状态更新。
    /**
     * 承接当前模块的核心控制分支。
     */
    async function handle_project_data_changed(event: MessageEvent<string>): Promise<void> {
      let payload: ProjectChangeEventPayload = {};
      try {
        payload = parse_event_payload(event) as ProjectChangeEventPayload;
        await projectEvents.handleProjectDataChangedPayload({
          payload,
          scheduler: refresh_scheduler,
          isCancelled: () => cancelled,
        });
      } catch (error) {
        report_state_error(error, {
          source: "sse",
          triggeringEvent: {
            topic: PROJECT_CHANGE_EVENT_TOPIC,
            ...summarize_project_change_payload_for_diagnostics(payload),
          },
          context: { stage: "parse_project_data_changed" },
        });
        void refresh_project_state_after_error("project_data_changed_event_failed", {
          topic: PROJECT_CHANGE_EVENT_TOPIC,
        });
      }
    }

    // attach_event_stream 封装当前模块的共享逻辑，避免重复实现同一维护规则。
    /**
     * 承接当前模块的核心控制分支。
     */
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
      } catch (error) {
        report_state_error(error, {
          source: "sse",
          context: { stage: "attach_event_stream" },
        });
      }
    }

    void attach_event_stream();

    return () => {
      cancelled = true;
      if (schedulerRef.current === refresh_scheduler) {
        schedulerRef.current = null;
      }
      refresh_scheduler.dispose();
      event_source?.close();
    };
  }, [
    applySettingsSnapshot,
    applyTaskSnapshot,
    refresh_project_state_after_error,
    refresh_task_after_state_error,
    report_state_error,
    refreshSettings,
    projectEvents,
    schedulerRef,
  ]);
}

// handle_scheduler_flush_error 是事件处理边界，只把外部事件转换为本模块状态更新。
/**
 * 承接当前模块的核心控制分支。
 */
function handle_scheduler_flush_error(
  error: unknown,
  context: DesktopRefreshSchedulerErrorContext,
  recovery: DesktopRecoveryActions,
): void {
  const triggering_event = summarize_scheduler_error_context(context);
  recovery.report_state_error(error, {
    source: "scheduler",
    triggeringEvent: triggering_event,
    context: { stage: "desktop_refresh_scheduler" },
  });
  if (context.phase === "project_change_batch") {
    void recovery.refresh_project_state_after_error(
      "scheduler_project_change_batch_failed",
      triggering_event,
    );
    return;
  }

  const failed_task_type = context.taskSnapshot?.task_type;
  void recovery.refresh_task_after_state_error(
    "scheduler_task_snapshot_failed",
    triggering_event,
    is_task_type(failed_task_type) ? failed_task_type : undefined,
  );
}

// 终态快照必须解除交互等待，不能被普通 500ms 合帧窗口延迟
/**
 * 判断当前值是否满足业务条件。
 */
function should_apply_task_snapshot_immediately(snapshot: TaskSnapshot): boolean {
  return (
    !snapshot.busy ||
    snapshot.status === "idle" ||
    snapshot.status === "done" ||
    snapshot.status === "error"
  );
}
