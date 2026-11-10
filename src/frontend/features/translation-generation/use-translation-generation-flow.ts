import type { WorkbenchQueryResponse } from "@shared/workbench/workbench-query";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import type {
  TranslationFileGenerationRequest,
  TranslationFileGenerationResult,
} from "@shared/translation-generation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { format_agent_reference } from "@shared/agent-reference";
import type { ProofreadingWarningCountResponse } from "@shared/proofreading/proofreading-types";
import { requires_agent_generation } from "@shared/translation-generation";
import { format_agent_input_steps } from "@frontend/app/navigation/agent-input-steps";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";

type TranslationGenerationReadyState = {
  phase: "ready";
  step: "warnings" | "files"; // 进入文件确认后，本次跳过审校的选择也随此阶段保留。
  warning_count: number;
  has_agent_files: boolean;
  has_supported_files: boolean;
  files_revision: number;
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
      previous: TranslationGenerationReadyState; // 失败后恢复确认前的可操作界面
    };

export type TranslationGenerationFlow = {
  state: TranslationGenerationState;
  can_request_generation: boolean;
  request_generation: () => void;
  retry_check: () => void;
  next_step: () => void;
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

  /** 文件范围与警告由各自的查询入口提供，旧工程和旧请求不参与确认。 */
  const load_generation_check = useCallback((): void => {
    const project = project_ref.current;
    if (!project.loaded || project.file_count === 0) {
      return;
    }
    const generation = ++request_generation_ref.current;
    apply_state({ phase: "checking" });
    void Promise.all([
      api_fetch<WorkbenchQueryResponse>("/api/workbench/snapshot", {}),
      api_fetch<ProofreadingWarningCountResponse>("/api/proofreading/query", {
        action: "warning_count",
      }),
    ])
      .then(([workbench, warnings]) => {
        if (
          generation !== request_generation_ref.current ||
          workbench.projectPath !== project.path ||
          warnings.projectPath !== project.path
        ) {
          return;
        }
        if (workbench.snapshot.entries.length === 0) {
          apply_state({ phase: "closed" });
          return;
        }
        if ((workbench.sectionRevisions.files ?? 0) !== (warnings.sectionRevisions.files ?? 0)) {
          apply_state({ phase: "check-failed" }); // 两次查询之间文件集合变化，重新读取后再确认。
          return;
        }
        apply_state({
          phase: "ready",
          step: warnings.warningCount > 0 ? "warnings" : "files",
          warning_count: warnings.warningCount,
          has_agent_files: workbench.snapshot.entries.some((entry) =>
            requires_agent_generation(entry.file_type),
          ),
          has_supported_files: workbench.snapshot.entries.some(
            (entry) => !requires_agent_generation(entry.file_type),
          ),
          files_revision: workbench.sectionRevisions.files ?? 0,
        });
      })
      .catch(() => {
        // 查询失败由弹窗提供重试与转交 Agent，不额外叠加 Toast。
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

  /** 下一步只确认跳过审校，目录选择和文件写出留给最终确认。 */
  const next_step = useCallback((): void => {
    const current = state_ref.current;
    if (current.phase !== "ready" || current.step !== "warnings" || !current.has_agent_files)
      return;
    apply_state({ ...current, step: "files" });
  }, [apply_state]);

  /** 译文生成期间锁定流程，失败后恢复用户确认前的状态。 */
  const confirm_generation = useCallback(async (): Promise<void> => {
    const current_state = state_ref.current;
    if (
      current_state.phase !== "ready" ||
      !current_state.has_supported_files ||
      (current_state.step === "warnings" && current_state.has_agent_files)
    ) {
      return;
    }
    const confirmed_state: TranslationGenerationReadyState = { ...current_state, step: "files" };
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
        expected_section_revisions: { files: current_state.files_revision },
        ...(output_directory === undefined ? {} : { output_directory }),
      };
      await api_fetch<TranslationFileGenerationResult>("/api/translation/files/generate", request);
      if (generation !== request_generation_ref.current) return;
      apply_state({ phase: "closed" });
    } catch (error) {
      if (generation !== request_generation_ref.current) return;
      push_error_toast(t("app.translation_generation.log.failed"), error);
      if (error instanceof DesktopApiError && error.code === "data.revision_conflict")
        load_generation_check();
      else apply_state(confirmed_state);
    }
  }, [apply_state, load_generation_check, settings_snapshot.translation_save_mode, t]);

  /** 进入 Agent 时追加当前任务的预置指令。 */
  const jump_to_agent = useCallback((): void => {
    const current_state = state_ref.current;
    if (current_state.phase !== "ready" && current_state.phase !== "check-failed") return;
    let text: string;
    if (current_state.phase === "ready" && current_state.step === "warnings") {
      text = format_agent_input_steps(t, [
        { label_key: "app.agent_input.steps.review", skill: "translation" },
        { label_key: "app.translation_generation.agent_request", skill: "project-operation" },
      ]);
    } else {
      text = `${t("app.translation_generation.agent_request")} ${format_agent_reference({ kind: "skill", name: "project-operation" })}`;
    }
    request_generation_ref.current += 1;
    apply_state({ phase: "closed" });
    navigate_to_agent({
      text,
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

  // 工程切换、关闭或删除最后一个文件时，淘汰确认状态和仍在途的请求。
  useEffect(() => {
    if (
      previous_project_identity_ref.current === project_identity &&
      project_snapshot.file_count > 0
    ) {
      return;
    }
    previous_project_identity_ref.current = project_identity;
    request_generation_ref.current += 1;
    apply_state({ phase: "closed" });
  }, [apply_state, project_identity, project_snapshot.file_count]);

  return useMemo(
    () => ({
      state,
      can_request_generation:
        project_snapshot.loaded && project_snapshot.file_count > 0 && state.phase === "closed",
      request_generation,
      retry_check,
      next_step,
      confirm_generation,
      jump_to_agent,
      close,
    }),
    [
      close,
      confirm_generation,
      jump_to_agent,
      project_snapshot.loaded,
      project_snapshot.file_count,
      request_generation,
      retry_check,
      next_step,
      state,
    ],
  );
}
