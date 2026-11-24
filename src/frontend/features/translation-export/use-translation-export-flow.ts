import type { WorkbenchQueryResponse } from "@shared/workbench/workbench-query";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import type {
  TranslationFileGenerationRequest,
  TranslationFileGenerationResult,
} from "@shared/translation-generation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { format_agent_reference } from "@shared/agent-reference";
import type { ProofreadingWarningCountResponse } from "@shared/proofreading/proofreading-types";
import { requires_agent_generation } from "@shared/translation-generation";
import { format_agent_input_steps } from "@frontend/app/navigation/agent-input-steps";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import {
  createTranslationExportStore,
  type TranslationExportReadyState,
  type TranslationExportState,
} from "@frontend/app/session/translation-export/translation-export-store";

export type { TranslationExportState };

export type TranslationExportFlow = {
  state: TranslationExportState;
  can_request_export: boolean;
  request_export: () => void;
  retry_check: () => void;
  next_step: () => void;
  confirm_export: () => Promise<void>;
  jump_to_agent: () => void;
  close: () => void;
};

/** 统一承接手动与任务完成后的翻译成果导出预检、确认和跳转。 */
export function useTranslationExportFlow(): TranslationExportFlow {
  const api_fetch = useProjectFetch();
  const { t } = useI18n();

  const { navigate_to_agent } = useAppNavigation();
  const { project_snapshot, settings_snapshot, active_project } = useDesktopState();
  const [local_store] = useState(createTranslationExportStore);
  const store = active_project?.translationExport ?? local_store;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const apply_state = store.applySnapshot;
  const project_ref = useRef(project_snapshot); // 稳定动作在开始时读取当前工程
  // loaded 状态变化也属于身份变化，关闭工程时必须失效旧流程。
  const project_identity = `${project_snapshot.loaded ? "loaded" : "empty"}:${project_snapshot.path}`;
  const previous_project_identity_ref = useRef(project_identity); // 只响应真正的项目身份切换

  project_ref.current = project_snapshot;

  /** 文件范围与警告由各自的查询入口提供，旧工程和旧请求不参与确认。 */
  const load_export_check = useCallback((): void => {
    const project = project_ref.current;
    if (!project.loaded || project.file_count === 0) {
      return;
    }
    const request_id = store.nextRequest();
    apply_state({ phase: "checking" });
    void Promise.all([
      api_fetch<WorkbenchQueryResponse>("/api/workbench/snapshot", {}),
      api_fetch<ProofreadingWarningCountResponse>("/api/proofreading/query", {
        action: "warning_count",
      }),
    ])
      .then(([workbench, warnings]) => {
        if (
          !store.isCurrent(request_id) ||
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
        if (store.isCurrent(request_id)) {
          apply_state({ phase: "check-failed" });
        }
      });
  }, [api_fetch, apply_state, store]);

  /** 从关闭态发起唯一一次翻译成果导出预检。 */
  const request_export = useCallback((): void => {
    if (store.getSnapshot().phase !== "closed") {
      return;
    }
    load_export_check();
  }, [load_export_check, store]);

  /** 失败态沿用同一查询入口重新检查。 */
  const retry_check = useCallback((): void => {
    if (store.getSnapshot().phase !== "check-failed") {
      return;
    }
    load_export_check();
  }, [load_export_check, store]);

  /** 下一步只确认跳过审校，目录选择和文件写出留给最终确认。 */
  const next_step = useCallback((): void => {
    const current = store.getSnapshot();
    if (current.phase !== "ready" || current.step !== "warnings" || !current.has_agent_files)
      return;
    apply_state({ ...current, step: "files" });
  }, [apply_state, store]);

  /** 翻译成果导出期间锁定流程，失败后恢复用户确认前的状态。 */
  const confirm_export = useCallback(async (): Promise<void> => {
    const current_state = store.getSnapshot();
    if (
      current_state.phase !== "ready" ||
      !current_state.has_supported_files ||
      (current_state.step === "warnings" && current_state.has_agent_files)
    ) {
      return;
    }
    const confirmed_state: TranslationExportReadyState = { ...current_state, step: "files" };
    const request_id = store.nextRequest();
    const project = project_ref.current;
    const mode = settings_snapshot.translation_save_mode; // 只有手动模式由前端提供目录。
    apply_state({ phase: "exporting", previous: current_state });
    try {
      let output_directory: string | undefined;
      if (mode === "MANUAL") {
        const result = await window.desktopApp.pickDirectory();
        if (!store.isCurrent(request_id)) return;
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
      if (!store.isCurrent(request_id)) return;
      apply_state({ phase: "closed" });
    } catch (error) {
      if (!store.isCurrent(request_id)) return;
      push_error_toast(t("app.translation_export.log.failed"), error);
      if (error instanceof DesktopApiError && error.code === "data.revision_conflict")
        load_export_check();
      else apply_state(confirmed_state);
    }
  }, [
    api_fetch,
    apply_state,
    load_export_check,
    settings_snapshot.translation_save_mode,
    store,
    t,
  ]);

  /** 进入 Agent 时追加当前任务的预置指令。 */
  const jump_to_agent = useCallback((): void => {
    const current_state = store.getSnapshot();
    if (current_state.phase !== "ready" && current_state.phase !== "check-failed") return;
    let text: string;
    if (current_state.phase === "ready" && current_state.step === "warnings") {
      text = format_agent_input_steps(t, [
        { label_key: "app.agent_input.steps.review", skill: "translation" },
        { label_key: "app.translation_export.agent_request", skill: "project-operation" },
      ]);
    } else {
      text = `${t("app.translation_export.agent_request")} ${format_agent_reference({ kind: "skill", name: "project-operation" })}`;
    }
    store.nextRequest();
    apply_state({ phase: "closed" });
    navigate_to_agent({
      text,
    });
  }, [apply_state, navigate_to_agent, store, t]);

  /** 非翻译成果导出态关闭弹窗，并淘汰仍在途的预检结果。 */
  const close = useCallback((): void => {
    if (store.getSnapshot().phase === "exporting") {
      return;
    }
    store.nextRequest();
    apply_state({ phase: "closed" });
  }, [apply_state, store]);

  // 工程切换、关闭或删除最后一个文件时，淘汰确认状态和仍在途的请求。
  useEffect(() => {
    if (
      previous_project_identity_ref.current === project_identity &&
      project_snapshot.file_count > 0
    ) {
      return;
    }
    previous_project_identity_ref.current = project_identity;
    store.nextRequest();
    apply_state({ phase: "closed" });
  }, [apply_state, project_identity, project_snapshot.file_count, store]);

  return useMemo(
    () => ({
      state,
      can_request_export:
        project_snapshot.loaded && project_snapshot.file_count > 0 && state.phase === "closed",
      request_export,
      retry_check,
      next_step,
      confirm_export,
      jump_to_agent,
      close,
    }),
    [
      close,
      confirm_export,
      jump_to_agent,
      project_snapshot.loaded,
      project_snapshot.file_count,
      request_export,
      retry_check,
      next_step,
      state,
    ],
  );
}
