import { useCallback, useMemo } from "react";

import { summarize_project_change_payload_for_diagnostics } from "@/app/desktop/desktop-runtime-diagnostics";
import type { DesktopRuntimeRecoveryActions } from "@/app/desktop/desktop-runtime-recovery";
import type { DesktopRuntimeRefreshScheduler } from "@/app/desktop/desktop-runtime-refresh-scheduler";
import { record_renderer_diagnostics_event } from "@/app/diagnostics/renderer-error-reporter";
import type { ProjectRuntimeChangeEvent } from "@/app/desktop/desktop-project-change-types";
import type { ProjectChangeEventPayload } from "@/app/desktop/desktop-project-change-normalizer";
import type { LogErrorContextInput } from "@shared/error";
import { PROJECT_CHANGE_EVENT_TOPIC } from "@shared/project-event";

export type { ProjectChangeEventPayload } from "@/app/desktop/desktop-project-change-normalizer";

/**
 * 项目事件处理只需要运行态项目身份，不直接读取完整项目事实。
 */
export type RuntimeProjectSnapshot = {
  loaded: boolean;
  path: string;
};

export type DesktopRuntimeProjectEventPipeline = {
  /** 调度器 flush 时唯一批量发布项目变更信号的入口。 */
  applyProjectChangeBatch: (events: readonly ProjectRuntimeChangeEvent[]) => void;
  /** 调度器 flush 前复用项目身份过滤，避免旧工程事件落地。 */
  shouldApplyProjectChange: (event: ProjectRuntimeChangeEvent) => boolean;
  /** 处理单条 project.data_changed payload，内部决定合并、补读或恢复。 */
  handleProjectDataChangedPayload: (args: {
    payload: ProjectChangeEventPayload;
    scheduler: DesktopRuntimeRefreshScheduler;
    isCancelled: () => boolean;
  }) => Promise<void>;
};

/**
 * Provider 装配项目事件管线时注入状态写入口、补读策略和恢复策略。
 */
type DesktopRuntimeProjectEventPipelineOptions = {
  projectSnapshot: RuntimeProjectSnapshot;
  applyProjectChangeBatch: (events: readonly ProjectRuntimeChangeEvent[]) => void;
  shouldApplyProjectChange: (event: ProjectRuntimeChangeEvent) => boolean;
  queueProjectChangeDuringSessionWarming: (event: ProjectRuntimeChangeEvent) => boolean;
  normalizeProjectChangeEvent: (
    payload: ProjectChangeEventPayload,
  ) => ProjectRuntimeChangeEvent | null;
  recovery: Pick<
    DesktopRuntimeRecoveryActions,
    "report_runtime_error" | "refresh_project_runtime_after_error"
  >;
};

/**
 * 项目 SSE 事件的唯一运行态管线，负责 session 初始化队列、补读、调度和失败恢复。
 */
export function useDesktopRuntimeProjectEventPipeline(
  options: DesktopRuntimeProjectEventPipelineOptions,
): DesktopRuntimeProjectEventPipeline {
  const {
    projectSnapshot,
    applyProjectChangeBatch,
    shouldApplyProjectChange,
    queueProjectChangeDuringSessionWarming,
    normalizeProjectChangeEvent,
    recovery,
  } = options;
  const { report_runtime_error, refresh_project_runtime_after_error } = recovery;

  // unmergeable 事件只能回到后端权威快照，不能在前端猜测补丁语义。
  const recover_unmergeable_project_event = useCallback(
    async (args: {
      scheduler: DesktopRuntimeRefreshScheduler;
      triggeringEvent: LogErrorContextInput;
      isCancelled: () => boolean;
    }): Promise<void> => {
      args.scheduler.flush();
      if (!projectSnapshot.loaded || projectSnapshot.path.trim() === "") {
        return;
      }

      await refresh_project_runtime_after_error(
        "project_data_changed_unmergeable",
        args.triggeringEvent,
        {
          stage: "refresh_project_runtime_after_unmergeable_event",
        },
      );

      if (args.isCancelled()) {
        return;
      }

      // recovery runner 会重新同步项目 session，并让页面按自身 query 读取后端事实。
    },
    [projectSnapshot.loaded, projectSnapshot.path, refresh_project_runtime_after_error],
  );

  const handleProjectDataChangedPayload = useCallback<
    DesktopRuntimeProjectEventPipeline["handleProjectDataChangedPayload"]
  >(
    async ({ payload, scheduler, isCancelled }) => {
      let triggering_event: LogErrorContextInput = {
        topic: PROJECT_CHANGE_EVENT_TOPIC,
      };
      try {
        triggering_event = {
          topic: PROJECT_CHANGE_EVENT_TOPIC,
          ...summarize_project_change_payload_for_diagnostics(payload),
        };
        // project 面包屑只写事件头摘要，避免崩溃日志记录完整 items/files delta。
        record_renderer_diagnostics_event(triggering_event);
        const change_event = normalizeProjectChangeEvent(payload);

        if (change_event === null) {
          await recover_unmergeable_project_event({
            scheduler,
            triggeringEvent: triggering_event,
            isCancelled,
          });
          return;
        }

        if (isCancelled()) {
          return;
        }
        if (queueProjectChangeDuringSessionWarming(change_event)) {
          return;
        }
        if (!shouldApplyProjectChange(change_event)) {
          return;
        }

        scheduler.enqueue_project_change(change_event);
      } catch (error) {
        report_runtime_error(error, {
          source: "sse",
          triggeringEvent: triggering_event,
          context: { stage: "handle_project_data_changed" },
        });
        await refresh_project_runtime_after_error(
          "project_data_changed_event_failed",
          triggering_event,
        );
      }
    },
    [
      normalizeProjectChangeEvent,
      projectSnapshot.loaded,
      projectSnapshot.path,
      queueProjectChangeDuringSessionWarming,
      recover_unmergeable_project_event,
      refresh_project_runtime_after_error,
      report_runtime_error,
      shouldApplyProjectChange,
    ],
  );

  return useMemo(
    () => ({
      applyProjectChangeBatch,
      shouldApplyProjectChange,
      handleProjectDataChangedPayload,
    }),
    [applyProjectChangeBatch, handleProjectDataChangedPayload, shouldApplyProjectChange],
  );
}
