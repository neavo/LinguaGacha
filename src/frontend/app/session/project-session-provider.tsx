import {
  type JSX,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import { useDesktopState, useProjectChangeSignal } from "@frontend/app/state/use-desktop-state";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import { BatchTaskDetailSheet } from "@frontend/features/batch-task/batch-task-detail-sheet";
import { build_translation_task_detail_display } from "@frontend/features/batch-task/batch-task-display";
import { TranslationExportDialog } from "@frontend/features/translation-export/translation-export-dialog";
import { useTranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import type { TranslationTaskConfirmState } from "@shared/batch-translation/batch-translation";
import type { ProjectDataSection } from "@shared/project-event";
import type {
  ProjectTranslationStats,
  ProjectTranslationStatsResponse,
} from "@shared/project-translation-stats";
import { BatchTaskRecoveryToast } from "./batch-task/batch-task-recovery-toast";
import {
  type BatchTaskSessionContextValue,
  BatchTaskSessionContext,
} from "./batch-task/batch-task-session-context";
import { type BatchTask, useBatchTask } from "./batch-task/use-batch-task";
import { ProjectTranslationStatsContext } from "./project-translation-stats-context";
import { TranslationExportContext } from "./translation-export/translation-export-context";

const STATS_SECTIONS: readonly ProjectDataSection[] = ["project", "items"];

/** 将翻译任务动作收口为确认框可见文案。 */
function resolve_translation_task_confirm_description(
  state: TranslationTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (state === null) return "";
  return state.kind === "reset-all"
    ? t("batch_translation.confirm.reset_all_description")
    : t("batch_translation.confirm.stop_description");
}

/** 工程会话独占统计查询；结果写入当前 ProjectStore 并在关联分区变更时串行补读。 */
function useProjectTranslationStatsSync(): ProjectTranslationStats | null {
  const api_fetch = useProjectFetch();
  const { project_snapshot, project_session_status, active_project } = useDesktopState();
  const change_seq = useProjectChangeSeqForSections(useProjectChangeSignal(), STATS_SECTIONS);
  const { t } = useI18n();

  const ready = project_snapshot.loaded && project_session_status === "ready";
  const project_path = project_snapshot.path;
  const [snapshot, set_snapshot] = useState<{
    path: string;
    stats: ProjectTranslationStats;
  } | null>(null);
  const refresh_ref = useRef<(() => void) | null>(null);
  const consumed_seq = useRef(change_seq);

  const report_error = useEffectEvent((error: unknown, retry: () => void): void => {
    push_error_toast(t("batch_translation.feedback.stats_refresh_failed"), error, {
      action: { label: t("app.action.retry"), onClick: retry },
    });
  });

  useLayoutEffect(() => {
    set_snapshot(
      active_project?.translationStats
        ? { path: project_path, stats: active_project.translationStats }
        : null,
    );
    if (!ready) return;
    // 每次工程加载拥有独立请求闭包，关闭、切换和同路径重载都会使旧回包及重试失效。
    let disposed = false;
    let running = false;
    let requested = false;
    async function read(): Promise<void> {
      running = true;
      do {
        requested = false;
        try {
          const result = await api_fetch<ProjectTranslationStatsResponse>(
            "/api/project/translation-stats",
            {},
          );
          if (!disposed && result.projectPath === project_path) {
            if (active_project) active_project.translationStats = result.stats;
            set_snapshot({ path: project_path, stats: result.stats });
          }
        } catch (error) {
          if (!disposed && !requested) report_error(error, refresh);
        }
      } while (!disposed && requested);
      running = false;
    }
    function refresh(): void {
      if (disposed) return;
      requested = true;
      if (!running) void read();
    }
    refresh_ref.current = refresh;
    refresh();
    return () => {
      disposed = true;
      refresh_ref.current = null;
    };
  }, [active_project, api_fetch, ready, project_path]);

  useEffect(() => {
    if (consumed_seq.current === change_seq) return;
    consumed_seq.current = change_seq;
    refresh_ref.current?.();
  }, [change_seq]);

  return ready && snapshot?.path === project_path ? snapshot.stats : null;
}

/** 工程级批量翻译详情与危险动作确认共用同一浮层层级。 */
function BatchTranslationDialogsLayer({ batch_task }: { batch_task: BatchTask }): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <BatchTaskDetailSheet
        empty_text={
          batch_task.task_metrics.total !== 0 &&
          (batch_task.task_metrics.active || batch_task.task_display_snapshot !== null)
            ? undefined
            : t("batch_translation.summary.empty")
        }
        open={batch_task.task_detail_sheet_open}
        display={build_translation_task_detail_display({
          config: batch_task.task_display_snapshot?.config ?? undefined,
          metrics: batch_task.task_metrics,
          completion_percent: batch_task.task_metrics.completion_percent,
          waveform_history: batch_task.task_waveform_history,
          t,
        })}
        on_close={batch_task.close_task_detail_sheet}
        on_request_stop_confirmation={() =>
          batch_task.request_task_action_confirmation("stop-translation")
        }
      />
      {/* 重置会批量清空译文，需要倒计时防误触，其它任务动作保持即时确认。 */}
      <AppConfirmDialog
        open={batch_task.task_confirm_state !== null}
        description={resolve_translation_task_confirm_description(batch_task.task_confirm_state, t)}
        submitting={batch_task.task_confirm_state?.submitting ?? false}
        confirmDelay={batch_task.task_confirm_state?.kind === "reset-all"}
        onConfirm={batch_task.confirm_task_action}
        onClose={batch_task.close_task_action_confirmation}
      />
    </>
  );
}

/** 统一装配当前工程工作区的翻译统计、成果导出与批量任务会话及浮层。 */
export function ProjectSessionProvider(props: { children: ReactNode }): JSX.Element {
  const stats = useProjectTranslationStatsSync();
  const translation_export = useTranslationExportFlow();
  const batch_task = useBatchTask({ onRequestExport: translation_export.request_export });
  const batch_task_context = useMemo<BatchTaskSessionContextValue>(
    () => ({ batch_task }),
    [batch_task],
  );

  return (
    <TranslationExportContext.Provider value={translation_export}>
      <ProjectTranslationStatsContext.Provider value={stats}>
        <BatchTaskSessionContext.Provider value={batch_task_context}>
          {props.children}
          <TranslationExportDialog {...translation_export} />
          <BatchTaskRecoveryToast />
          <BatchTranslationDialogsLayer batch_task={batch_task} />
        </BatchTaskSessionContext.Provider>
      </ProjectTranslationStatsContext.Provider>
    </TranslationExportContext.Provider>
  );
}
