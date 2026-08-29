import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { format_agent_skill_reference } from "@shared/agent";
import type { ProofreadingWarningSummary } from "@shared/proofreading/proofreading-types";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useAgentInput } from "@frontend/app/session/agent/agent-session-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";

type TranslationExportReadyState = {
  phase: "ready";
  summary: ProofreadingWarningSummary;
};

type TranslationExportFailedState = {
  phase: "check-failed";
};

export type TranslationExportState =
  | { phase: "closed" }
  | { phase: "checking" }
  | TranslationExportReadyState
  | TranslationExportFailedState
  | {
      phase: "exporting";
      previous: TranslationExportReadyState | TranslationExportFailedState; // 失败后恢复确认前的可操作界面
    };

type ProofreadingWarningSummaryResponse = {
  projectPath: string;
  warningSummary: ProofreadingWarningSummary;
};

export type TranslationExportFlow = {
  state: TranslationExportState;
  can_request_export: boolean;
  request_export: () => void;
  retry_check: () => void;
  confirm_export: () => Promise<void>;
  jump_to_agent: () => void;
  close: () => void;
};

/** 统一承接手动与任务完成后的译文导出预检、确认和跳转。 */
export function useTranslationExportFlow(): TranslationExportFlow {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { navigate_to_route } = useAppNavigation();
  const agent_input = useAgentInput();
  const { project_snapshot } = useDesktopState();
  const [state, set_state] = useState<TranslationExportState>({ phase: "closed" });
  const state_ref = useRef(state); // 稳定动作读取即时 phase，阻止同一帧重复提交
  const project_ref = useRef(project_snapshot); // 异步查询完成时核对当前项目身份
  // loaded 状态变化也属于身份变化，关闭工程时必须失效旧流程。
  const project_identity = `${project_snapshot.loaded ? "loaded" : "empty"}:${project_snapshot.path}`;
  const previous_project_identity_ref = useRef(project_identity); // 只响应真正的项目身份切换
  const request_generation_ref = useRef(0); // 关闭、重试和项目切换都会淘汰迟到查询

  project_ref.current = project_snapshot;

  /** 同步 React state 与动作读取的即时镜像。 */
  const apply_state = useCallback((next_state: TranslationExportState): void => {
    state_ref.current = next_state;
    set_state(next_state);
  }, []);

  /** 读取当前项目的权威 warning 摘要，并隔离旧项目或旧请求结果。 */
  const load_warning_summary = useCallback((): void => {
    const project = project_ref.current;
    if (!project.loaded) {
      return;
    }
    const generation = ++request_generation_ref.current;
    apply_state({ phase: "checking" });
    void api_fetch<ProofreadingWarningSummaryResponse>("/api/proofreading/query", {
      action: "warning_summary",
    })
      .then((response) => {
        if (
          generation !== request_generation_ref.current ||
          !project_ref.current.loaded ||
          project_ref.current.path !== project.path ||
          response.projectPath !== project.path
        ) {
          return;
        }
        apply_state({ phase: "ready", summary: response.warningSummary });
      })
      .catch(() => {
        // 查询失败由弹窗提供重试与继续导出，不额外叠加 Toast。
        if (
          generation === request_generation_ref.current &&
          project_ref.current.loaded &&
          project_ref.current.path === project.path
        ) {
          apply_state({ phase: "check-failed" });
        }
      });
  }, [apply_state]);

  /** 从关闭态发起唯一一次导出预检。 */
  const request_export = useCallback((): void => {
    if (state_ref.current.phase !== "closed") {
      return;
    }
    load_warning_summary();
  }, [load_warning_summary]);

  /** 失败态沿用同一查询入口重新检查。 */
  const retry_check = useCallback((): void => {
    if (state_ref.current.phase !== "check-failed") {
      return;
    }
    load_warning_summary();
  }, [load_warning_summary]);

  /** 导出期间锁定流程，失败后恢复用户确认前的状态。 */
  const confirm_export = useCallback(async (): Promise<void> => {
    const current_state = state_ref.current;
    if (current_state.phase !== "ready" && current_state.phase !== "check-failed") {
      return;
    }
    apply_state({ phase: "exporting", previous: current_state });
    try {
      await api_fetch("/api/translation/files/export", {});
      apply_state({ phase: "closed" });
    } catch {
      push_toast("error", t("workbench_page.feedback.generate_translation_failed"));
      apply_state(current_state);
    }
  }, [apply_state, push_toast, t]);

  /** 使用 Agent 空态卡片正文覆盖普通草稿，并进入 Agent 页面。 */
  const jump_to_agent = useCallback((): void => {
    const current_state = state_ref.current;
    if (current_state.phase !== "ready" || current_state.summary.total_count === 0) {
      return;
    }
    agent_input.write_draft({
      text: `${t("agent_page.empty.suggestions.translation_workflow")} ${format_agent_skill_reference("translation-workflow")}`,
      attachments: [],
    });
    request_generation_ref.current += 1;
    apply_state({ phase: "closed" });
    navigate_to_route("agent");
  }, [agent_input, apply_state, navigate_to_route, t]);

  /** 非导出态关闭弹窗，并淘汰仍在途的预检结果。 */
  const close = useCallback((): void => {
    if (state_ref.current.phase === "exporting") {
      return;
    }
    request_generation_ref.current += 1;
    apply_state({ phase: "closed" });
  }, [apply_state]);

  // 项目切换或关闭时，跨路由导出流程不得保留旧工程确认状态。
  useEffect(() => {
    if (previous_project_identity_ref.current === project_identity) {
      return;
    }
    previous_project_identity_ref.current = project_identity;
    request_generation_ref.current += 1;
    apply_state({ phase: "closed" });
  }, [apply_state, project_identity]);

  return useMemo(
    () => ({
      state,
      can_request_export: project_snapshot.loaded && state.phase === "closed",
      request_export,
      retry_check,
      confirm_export,
      jump_to_agent,
      close,
    }),
    [
      close,
      confirm_export,
      jump_to_agent,
      project_snapshot.loaded,
      request_export,
      retry_check,
      state,
    ],
  );
}
