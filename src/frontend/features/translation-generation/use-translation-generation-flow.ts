import type { WorkbenchQueryResponse } from "@shared/workbench/workbench-query";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import type {
  TranslationFileGenerationRequest,
  TranslationFileGenerationResult,
} from "@shared/translation-generation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { format_agent_reference } from "@shared/agent-reference";
import type { ProofreadingWarningSummary } from "@shared/proofreading/proofreading-types";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import {
  format_agent_input_steps,
  type AgentInputStep,
} from "@frontend/app/navigation/agent-input-steps";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";

// 有校对警告时先审校，再生成全部译文。
const TRANSLATION_GENERATION_STEPS = [
  { label_key: "app.agent_input.steps.review", skill: "translation" },
  { label_key: "app.agent_input.steps.generate", skill: "project-operation" },
] as const satisfies readonly AgentInputStep[];

type TranslationGenerationReadyState = {
  phase: "ready";
  summary: ProofreadingWarningSummary;
  has_generic: boolean;
};

type TranslationGenerationFailedState = {
  phase: "check-failed";
};

export type TranslationGenerationState =
  | { phase: "closed" }
  | { phase: "checking" }
  | TranslationGenerationReadyState
  | TranslationGenerationFailedState
  | {
      phase: "generating";
      previous: TranslationGenerationReadyState | TranslationGenerationFailedState; // 失败后恢复确认前的可操作界面
    };

type ProofreadingWarningSummaryResponse = {
  projectPath: string;
  warningSummary: ProofreadingWarningSummary;
};

export type TranslationGenerationFlow = {
  state: TranslationGenerationState;
  can_request_generation: boolean;
  request_generation: () => void;
  retry_check: () => void;
  confirm_generation: () => Promise<void>;
  jump_to_agent: () => void;
  close: () => void;
};

/** 统一承接手动与任务完成后的译文生成预检、确认和跳转。 */
export function useTranslationGenerationFlow(): TranslationGenerationFlow {
  const { t } = useI18n();

  const { navigate_to_agent } = useAppNavigation();
  const { project_snapshot, settings_snapshot } = useDesktopState();
  const [state, set_state] = useState<TranslationGenerationState>({ phase: "closed" });
  const state_ref = useRef(state); // 稳定动作读取即时 phase，阻止同一帧重复提交
  const project_ref = useRef(project_snapshot); // 稳定动作在开始时读取当前工程
  // loaded 状态变化也属于身份变化，关闭工程时必须失效旧流程。
  const project_identity = `${project_snapshot.loaded ? "loaded" : "empty"}:${project_snapshot.path}`;
  const previous_project_identity_ref = useRef(project_identity); // 只响应真正的项目身份切换
  const request_generation_ref = useRef(0); // 关闭、重试和项目切换都会淘汰迟到查询

  project_ref.current = project_snapshot;

  /** 同步 React state 与动作读取的即时镜像。 */
  const apply_state = useCallback((next_state: TranslationGenerationState): void => {
    state_ref.current = next_state;
    set_state(next_state);
  }, []);

  /** 读取当前工程文件与校对摘要，并隔离旧项目或旧请求结果。 */
  const load_generation_check = useCallback((): void => {
    const project = project_ref.current;
    if (!project.loaded) {
      return;
    }
    const generation = ++request_generation_ref.current;
    apply_state({ phase: "checking" });
    void Promise.all([
      api_fetch<ProofreadingWarningSummaryResponse>("/api/proofreading/query", {
        action: "warning_summary",
      }),
      api_fetch<WorkbenchQueryResponse>("/api/workbench/snapshot", {}),
    ])
      .then(([response, workbench]) => {
        if (
          generation !== request_generation_ref.current ||
          response.projectPath !== project.path ||
          workbench.projectPath !== project.path
        ) {
          return;
        }
        apply_state({
          phase: "ready",
          summary: response.warningSummary,
          has_generic: workbench.snapshot.entries.some((entry) => entry.file_type === "GENERIC"),
        });
      })
      .catch(() => {
        // 查询失败由弹窗提供重试与继续译文生成，不额外叠加 Toast。
        if (generation === request_generation_ref.current) {
          apply_state({ phase: "check-failed" });
        }
      });
  }, [apply_state]);

  /** 从关闭态发起唯一一次译文生成预检。 */
  const request_generation = useCallback((): void => {
    if (state_ref.current.phase !== "closed") {
      return;
    }
    load_generation_check();
  }, [load_generation_check]);

  /** 失败态沿用同一查询入口重新检查。 */
  const retry_check = useCallback((): void => {
    if (state_ref.current.phase !== "check-failed") {
      return;
    }
    load_generation_check();
  }, [load_generation_check]);

  /** 译文生成期间锁定流程，失败后恢复用户确认前的状态。 */
  const confirm_generation = useCallback(async (): Promise<void> => {
    const current_state = state_ref.current;
    if (current_state.phase !== "ready" && current_state.phase !== "check-failed") {
      return;
    }
    const generation = request_generation_ref.current;
    const project = project_ref.current;
    const mode = settings_snapshot.translation_save_mode; // 只有手动模式由前端提供目录。
    apply_state({ phase: "generating", previous: current_state });
    try {
      let output_directory: string | undefined;
      if (mode === "MANUAL") {
        const result = await window.desktopApp.pickDirectory();
        if (generation !== request_generation_ref.current) return;
        if (result.canceled || !result.paths[0]) {
          apply_state({ phase: "closed" });
          return;
        }
        output_directory = result.paths[0];
      }
      const request: TranslationFileGenerationRequest = {
        project_path: project.path,
        ...(output_directory === undefined ? {} : { output_directory }),
      };
      await api_fetch<TranslationFileGenerationResult>("/api/translation/files/generate", request);
      if (generation !== request_generation_ref.current) return;
      apply_state({ phase: "closed" });
    } catch (error) {
      if (generation !== request_generation_ref.current) return;
      push_error_toast(t("app.translation_generation.log.failed"), error);
      apply_state(current_state);
    }
  }, [apply_state, settings_snapshot.translation_save_mode, t]);

  /** 进入 Agent 时追加当前任务的预置指令。 */
  const jump_to_agent = useCallback((): void => {
    const current_state = state_ref.current;
    if (
      current_state.phase !== "ready" ||
      (current_state.summary.total_count === 0 && !current_state.has_generic)
    ) {
      return;
    }
    request_generation_ref.current += 1;
    apply_state({ phase: "closed" });
    navigate_to_agent({
      text:
        current_state.summary.total_count > 0
          ? format_agent_input_steps(t, TRANSLATION_GENERATION_STEPS)
          : `${t("app.translation_generation.agent_request")} ${format_agent_reference({ kind: "skill", name: "project-operation" })}`,
    });
  }, [apply_state, navigate_to_agent, t]);

  /** 非译文生成态关闭弹窗，并淘汰仍在途的预检结果。 */
  const close = useCallback((): void => {
    if (state_ref.current.phase === "generating") {
      return;
    }
    request_generation_ref.current += 1;
    apply_state({ phase: "closed" });
  }, [apply_state]);

  // 项目切换或关闭时，跨路由译文生成流程不得保留旧工程确认状态。
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
      can_request_generation: project_snapshot.loaded && state.phase === "closed",
      request_generation,
      retry_check,
      confirm_generation,
      jump_to_agent,
      close,
    }),
    [
      close,
      confirm_generation,
      jump_to_agent,
      project_snapshot.loaded,
      request_generation,
      retry_check,
      state,
    ],
  );
}
