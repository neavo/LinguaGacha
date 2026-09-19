import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopState, useProjectChangeSignal } from "@frontend/app/state/use-desktop-state";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { ProjectDataSection } from "@shared/project-event";
import type {
  ProjectTranslationStats,
  ProjectTranslationStatsResponse,
} from "@shared/project-translation-stats";
import { ProjectTranslationStatsContext } from "./project-translation-stats-context";

const STATS_SECTIONS: readonly ProjectDataSection[] = ["project", "items"];

/** 工程会话独占统计查询；任务显示时钟和各页面只消费结果。 */
export function ProjectTranslationStatsProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_session_status } = useDesktopState();
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
    push_toast(
      "error",
      resolve_visible_error_message(error, t, t("batch_translation.feedback.stats_refresh_failed")),
      {
        action: {
          label: t("app.action.retry"),
          onClick: retry,
        },
      },
    );
  });

  useLayoutEffect(() => {
    set_snapshot(null);
    if (!ready) return;
    // 每次工程加载拥有独立请求闭包，关闭、切换和同路径重载都会使旧回包及重试失效。
    let disposed = false;
    let running = false; // 当前是否已有串行读取循环
    let requested = false; // 读取期间的新刷新意图，由循环完成后接续
    /** 持续发布已读统计并补读后续变化，避免长任务的进度停在旧值。 */
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
            set_snapshot({ path: project_path, stats: result.stats });
          }
        } catch (error) {
          // 过期请求无需提示；已有补读时由其报告最终结果，避免重复报错。
          if (!disposed && !requested) report_error(error, refresh);
        }
      } while (!disposed && requested);
      running = false;
    }
    /** 合并刷新请求，当前循环结束前不启动并发查询。 */
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
  }, [ready, project_path]);

  useEffect(() => {
    if (consumed_seq.current === change_seq) return;
    consumed_seq.current = change_seq;
    refresh_ref.current?.();
  }, [change_seq]);

  const stats = ready && snapshot?.path === project_path ? snapshot.stats : null;
  return (
    <ProjectTranslationStatsContext.Provider value={stats}>
      {props.children}
    </ProjectTranslationStatsContext.Provider>
  );
}
