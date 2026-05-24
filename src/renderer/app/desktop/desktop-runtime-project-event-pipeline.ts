import { useCallback, useMemo } from "react";

import { summarize_project_change_payload_for_diagnostics } from "@/app/desktop/desktop-runtime-diagnostics";
import type { DesktopRuntimeRecoveryActions } from "@/app/desktop/desktop-runtime-recovery";
import type { DesktopRuntimeRefreshScheduler } from "@/app/desktop/desktop-runtime-refresh-scheduler";
import { record_renderer_diagnostics_event } from "@/app/diagnostics/renderer-error-reporter";
import type { ProjectStoreChangeEvent, ProjectStoreStage } from "@/project/store/project-store";
import type { ProjectChangeEventPayload } from "@/app/desktop/desktop-project-change-normalizer";
import type { ErrorDiagnosticContextInput } from "@shared/error";
import { PROJECT_CHANGE_EVENT_TOPIC } from "@shared/project/event";

export type { ProjectChangeEventPayload } from "@/app/desktop/desktop-project-change-normalizer";

/**
 * 项目事件处理只需要运行态项目身份，不直接读取完整 ProjectStore。
 */
export type RuntimeProjectSnapshot = {
  loaded: boolean;
  path: string;
};

export type DesktopRuntimeProjectEventPipeline = {
  /** 调度器 flush 时唯一批量写入 ProjectStore 的入口。 */
  applyProjectChangeBatch: (events: readonly ProjectStoreChangeEvent[]) => void;
  /** 调度器 flush 前复用项目身份过滤，避免旧工程事件落地。 */
  shouldApplyProjectChange: (event: ProjectStoreChangeEvent) => boolean;
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
  applyProjectChange: (event: ProjectStoreChangeEvent, revisionMode?: "merge" | "exact") => void;
  applyProjectChangeBatch: (events: readonly ProjectStoreChangeEvent[]) => void;
  shouldApplyProjectChange: (event: ProjectStoreChangeEvent) => boolean;
  queueProjectChangeDuringWarmup: (event: ProjectStoreChangeEvent) => boolean;
  normalizeProjectChangeEvent: (
    payload: ProjectChangeEventPayload,
  ) => ProjectStoreChangeEvent | null;
  collectProjectChangeSectionsRequiringRead: (
    event: ProjectStoreChangeEvent,
  ) => ProjectStoreStage[];
  readProjectSectionsForChange: (
    event: ProjectStoreChangeEvent,
    sections: ProjectStoreStage[],
  ) => Promise<ProjectStoreChangeEvent | null>;
  recovery: Pick<
    DesktopRuntimeRecoveryActions,
    "report_runtime_error" | "refresh_project_runtime_after_error"
  >;
};

/**
 * 项目 SSE 事件的唯一运行态管线，负责 warmup 队列、补读、调度和失败恢复。
 */
export function useDesktopRuntimeProjectEventPipeline(
  options: DesktopRuntimeProjectEventPipelineOptions,
): DesktopRuntimeProjectEventPipeline {
  const {
    projectSnapshot,
    applyProjectChange,
    applyProjectChangeBatch,
    shouldApplyProjectChange,
    queueProjectChangeDuringWarmup,
    normalizeProjectChangeEvent,
    collectProjectChangeSectionsRequiringRead,
    readProjectSectionsForChange,
    recovery,
  } = options;
  const { report_runtime_error, refresh_project_runtime_after_error } = recovery;

  // unmergeable 事件只能回到后端权威快照，不能在前端猜测补丁语义。
  const recover_unmergeable_project_event = useCallback(
    async (args: {
      scheduler: DesktopRuntimeRefreshScheduler;
      triggeringEvent: ErrorDiagnosticContextInput;
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

      // recovery runner 内部会写入 ProjectStore 并发布标准 ProjectRuntimeChangeSignal。
    },
    [projectSnapshot.loaded, projectSnapshot.path, refresh_project_runtime_after_error],
  );

  const handleProjectDataChangedPayload = useCallback<
    DesktopRuntimeProjectEventPipeline["handleProjectDataChangedPayload"]
  >(
    async ({ payload, scheduler, isCancelled }) => {
      let triggering_event: ErrorDiagnosticContextInput = {
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
        if (queueProjectChangeDuringWarmup(change_event)) {
          return;
        }
        if (!shouldApplyProjectChange(change_event)) {
          return;
        }

        const invalidated_sections = collectProjectChangeSectionsRequiringRead(change_event);
        if (invalidated_sections.length > 0) {
          scheduler.flush();
          if (!projectSnapshot.loaded || projectSnapshot.path.trim() === "") {
            return;
          }

          const read_sections_event = await readProjectSectionsForChange(
            change_event,
            invalidated_sections,
          );
          if (isCancelled()) {
            return;
          }
          if (read_sections_event !== null) {
            applyProjectChange(read_sections_event, "exact");
          }
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
      applyProjectChange,
      collectProjectChangeSectionsRequiringRead,
      normalizeProjectChangeEvent,
      projectSnapshot.loaded,
      projectSnapshot.path,
      queueProjectChangeDuringWarmup,
      readProjectSectionsForChange,
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
