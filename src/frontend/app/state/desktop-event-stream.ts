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
import { type BatchTranslationSnapshot } from "@domain/batch-translation";
import { normalize_batch_translation_snapshot } from "@shared/workbench/batch-translation";

import { normalize_runtime_activity_snapshot } from "@frontend/app/state/runtime-activity-store";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { record_renderer_diagnostics_event } from "@frontend/app/diagnostics/renderer-error-reporter";
import { parse_event_payload } from "@frontend/app/state/desktop-event-payload";
import { PROJECT_CHANGE_EVENT_TOPIC } from "@shared/project-event";
import {
  RUNTIME_ACTIVITY_EVENT_TOPIC,
  type RuntimeActivitySnapshot,
} from "@shared/runtime-activity";

type SettingsChangedEventPayload = {
  keys?: unknown;
  settings?: SettingsSnapshotPayload["settings"];
};

type DesktopEventStreamOptions = {
  schedulerRef: MutableRefObject<DesktopRefreshScheduler | null>;
  applySettingsSnapshot: (payload: SettingsSnapshotPayload) => void;
  applyTaskSnapshot: (snapshot: BatchTranslationSnapshot) => void;
  applyRuntimeSnapshot: (snapshot: RuntimeActivitySnapshot) => void;
  refreshSettings: () => Promise<unknown>;
  refreshRuntime: () => Promise<unknown>;
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
    applyRuntimeSnapshot,
    refreshSettings,
    refreshRuntime,
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

    function handle_task_snapshot_changed(event: MessageEvent<string>): void {
      let payload: Record<string, unknown> = {};
      try {
        payload = parse_event_payload(event);
        const task_snapshot = normalize_batch_translation_snapshot(payload);
        // task 面包屑先于调度分支记录，保证崩溃发生在 enqueue/flush 之间时仍有最新进度。
        record_renderer_diagnostics_event({
          topic: "batch_translation.snapshot_changed",
          batch_translation: summarize_task_snapshot_for_diagnostics(task_snapshot),
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
            topic: "batch_translation.snapshot_changed",
            batch_translation: payload,
          },
          context: { stage: "handle_task_snapshot_changed" },
        });
        void refresh_task_after_state_error("task_snapshot_event_failed", {
          topic: "batch_translation.snapshot_changed",
        });
      }
    }

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

    /** runtime 快照不参与合帧；锁定与解锁必须立即反映到所有页面。 */
    function handle_runtime_snapshot_changed(event: MessageEvent<string>): void {
      let payload: Record<string, unknown> = {};
      try {
        payload = parse_event_payload(event);
        applyRuntimeSnapshot(normalize_runtime_activity_snapshot(payload));
      } catch (error) {
        report_state_error(error, {
          source: "sse",
          triggeringEvent: { topic: RUNTIME_ACTIVITY_EVENT_TOPIC, runtime: payload },
          context: { stage: "handle_runtime_snapshot_changed" },
        });
        void refreshRuntime().catch((refresh_error: unknown) => {
          report_state_error(refresh_error, {
            source: "state-recovery",
            triggeringEvent: { topic: RUNTIME_ACTIVITY_EVENT_TOPIC },
            context: { stage: "refresh_runtime_after_event_failure" },
          });
        });
      }
    }

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

    /** 重连可能跨过任意增量事件，各状态域统一回到自身权威读取入口。 */
    async function restore_state_after_reconnect(): Promise<void> {
      refresh_scheduler.flush();
      await Promise.all([
        refreshSettings().catch((error: unknown) => {
          report_state_error(error, {
            source: "state-recovery",
            context: { stage: "refresh_settings_after_reconnect" },
          });
        }),
        refreshRuntime().catch((error: unknown) => {
          report_state_error(error, {
            source: "state-recovery",
            context: { stage: "refresh_runtime_after_reconnect" },
          });
        }),
        refresh_task_after_state_error("event_stream_reconnected", {
          topic: "batch_translation.snapshot_changed",
        }),
        refresh_project_state_after_error("event_stream_reconnected", {
          topic: PROJECT_CHANGE_EVENT_TOPIC,
        }),
      ]);
    }

    function attach_event_stream(): void {
      try {
        const next_event_source = open_event_stream();
        event_source = next_event_source;
        let opened_once = false; // 首次 open 由初始快照负责，后续 open 才代表需要恢复的重连
        next_event_source.onopen = () => {
          if (cancelled) {
            return;
          }
          if (opened_once) {
            void restore_state_after_reconnect();
          }
          opened_once = true;
        };
        event_source.addEventListener(
          "batch_translation.snapshot_changed",
          handle_task_snapshot_changed as EventListener,
        );
        event_source.addEventListener("settings.changed", handle_settings_changed as EventListener);
        event_source.addEventListener(
          RUNTIME_ACTIVITY_EVENT_TOPIC,
          handle_runtime_snapshot_changed as EventListener,
        );
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

    attach_event_stream();

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
    applyRuntimeSnapshot,
    refresh_project_state_after_error,
    refresh_task_after_state_error,
    report_state_error,
    refreshSettings,
    refreshRuntime,
    projectEvents,
    schedulerRef,
  ]);
}

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

  void recovery.refresh_task_after_state_error("scheduler_task_snapshot_failed", triggering_event);
}

// 终态快照必须解除交互等待，不能被普通 500ms 合帧窗口延迟
function should_apply_task_snapshot_immediately(snapshot: BatchTranslationSnapshot): boolean {
  return snapshot.status === "idle" || snapshot.status === "done" || snapshot.status === "error";
}
