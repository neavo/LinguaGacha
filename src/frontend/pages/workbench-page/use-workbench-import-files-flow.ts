import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import type { LocaleKey } from "@frontend/app/locale/locale-context";
import { normalize_source_paths } from "@frontend/app/desktop/source-paths";
import {
  format_source_file_parse_failure_error_toast,
  format_source_file_parse_failure_toast,
} from "@frontend/app/feedback/source-file-parse-failure-feedback";
import {
  create_workbench_import_files_plan,
  create_workbench_import_files_preview,
  type WorkbenchFileConflictAction,
  type WorkbenchImportFileCandidate,
  type WorkbenchImportFilesPreview,
  type WorkbenchCommandPlanningState,
  type WorkbenchPlannerSettings,
  type WorkbenchCommandPlan,
} from "@shared/workbench/workbench-command-planner";
import type { WorkbenchDialogState } from "@frontend/pages/workbench-page/types";

type PendingImportFilesRequest = {
  candidates: WorkbenchImportFileCandidate[]; // Backend 只读发现的导入候选
  conflict_action: WorkbenchFileConflictAction | null;
  source_paths: string[];
  files_revision: number; // 名称分配绑定准备前的文件修订，变化后重新准备。
};

type WorkbenchImportFlowToastKind = "info" | "success" | "warning";

type WorkbenchImportFilesFlowOptions = {
  readonly: boolean;
  project_identity: string;
  dialog_state: WorkbenchDialogState;
  get_planning_state: () => WorkbenchCommandPlanningState;
  planner_settings: WorkbenchPlannerSettings; // 导入命令只需要预过滤设置，不依赖完整应用设置快照
  run_modal_progress_toast: <T>(args: {
    message: string;
    task: () => Promise<T>;
    timeout_ms?: number;
  }) => Promise<T>;
  run_project_file_write: (
    plan: WorkbenchCommandPlan,
    request: (body: Record<string, unknown>) => Promise<ProjectWriteResultPayload>,
  ) => Promise<ProjectWriteResultPayload>;
  set_dialog_state: Dispatch<SetStateAction<WorkbenchDialogState>>;
  set_dialog_submitting: (next_submitting: boolean) => void;
  push_toast: (kind: WorkbenchImportFlowToastKind, message: string) => unknown;
  t: (key: LocaleKey, params?: Record<string, string>) => string;
};

export type WorkbenchImportFilesFlow = {
  request_add_files_from_paths: (source_paths: string[]) => Promise<void>;
  request_add_file_from_path: (source_path: string) => Promise<void>;
  confirm_dialog: () => Promise<boolean>;
  secondary_dialog: () => Promise<boolean>;
  close_dialog: () => boolean;
};

/**
 * 构建关闭态工作台对话框，供导入流程和主工作台 Hook 共用同一空值形状。
 */
export function close_dialog_state(): WorkbenchDialogState {
  return {
    kind: null,
    target_rel_paths: [],
    pending_path: null,
    submitting: false,
  };
}

/**
 * 收窄 Backend 导入预览响应中的单个导入候选，避免脏 payload 进入导入状态机。
 */
function normalize_workbench_import_candidate(
  payload: unknown,
): WorkbenchImportFileCandidate | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("source_path" in payload) ||
    typeof payload.source_path !== "string" ||
    !("target_rel_path" in payload) ||
    typeof payload.target_rel_path !== "string"
  )
    return null;
  return { source_path: payload.source_path, target_rel_path: payload.target_rel_path };
}

/**
 * 工作台导入文件流程集中管理导入预览、冲突确认、继承确认和最终提交。
 */
export function useWorkbenchImportFilesFlow(
  options: WorkbenchImportFilesFlowOptions,
): WorkbenchImportFilesFlow {
  const [pending_import_files_request, set_pending_import_files_request] =
    useState<PendingImportFilesRequest | null>(null);

  useEffect(() => {
    set_pending_import_files_request(null);
  }, [options.project_identity]);

  /**
   * 打开同名冲突确认对话框，保留当前准备结果。
   */
  const open_import_conflict_dialog = useCallback(
    (pending_request: PendingImportFilesRequest, preview: WorkbenchImportFilesPreview): void => {
      // 同名确认保留准备时的名称与修订，不把预演结果当作最终项目事实。
      set_pending_import_files_request({
        ...pending_request,
        conflict_action: null,
      });
      options.set_dialog_state({
        kind: "confirm-import-files",
        target_rel_paths: preview.conflicting_files.map((file) => file.target_rel_path),
        pending_path: preview.conflicting_files[0]?.source_path ?? null,
        submitting: false,
      });
    },
    [options],
  );

  /**
   * 打开译文继承确认对话框，按冲突策略筛出本次真正会导入的文件。
   */
  const open_import_inheritance_dialog = useCallback(
    (
      pending_request: PendingImportFilesRequest,
      conflict_action: WorkbenchFileConflictAction,
      preview: WorkbenchImportFilesPreview,
    ): void => {
      // 跳过策略只继承新文件；替换策略需要同时展示新增文件和即将重建的同名文件。
      const files_to_import =
        conflict_action === "replace" ? preview.importable_files : preview.new_files;
      if (files_to_import.length === 0) {
        set_pending_import_files_request(null);
        options.set_dialog_state(close_dialog_state());
        return;
      }

      set_pending_import_files_request({
        ...pending_request,
        conflict_action,
      });
      options.set_dialog_state({
        kind: "inherit-import-files",
        target_rel_paths: files_to_import.map((file) => file.target_rel_path),
        pending_path: files_to_import[0]?.source_path ?? null,
        submitting: false,
      });
    },
    [options],
  );

  /**
   * 发现用户选择的源路径，按冲突情况进入策略确认或继承确认。
   */
  const request_add_files_from_paths = useCallback(
    async (source_paths: string[]): Promise<void> => {
      if (options.readonly) {
        return;
      }

      // 准备接管流程时退出旧确认，空结果或异常都不能留下失效请求。
      set_pending_import_files_request(null);
      options.set_dialog_state(close_dialog_state());
      const normalized_source_paths = normalize_source_paths(source_paths);
      if (normalized_source_paths.length === 0) {
        push_error_toast(
          options.t("app.feedback.operation_failed"),
          options.t("workbench_page.feedback.no_valid_file"),
        );
        return;
      }

      const files_revision = options.get_planning_state().section_revisions.files ?? 0;
      const candidates: WorkbenchImportFileCandidate[] = [];

      await options.run_modal_progress_toast({
        message: options.t("workbench_page.feedback.add_file_loading_toast"),
        task: async () => {
          const payload = await api_fetch<{ files?: unknown }>("/api/workbench/files/preview", {
            source_paths: normalized_source_paths,
          });
          const preview_files = Array.isArray(payload.files) ? payload.files : [];

          for (const preview_file of preview_files) {
            const candidate = normalize_workbench_import_candidate(preview_file);
            if (candidate !== null) candidates.push(candidate);
          }
        },
      });

      const import_preview = create_workbench_import_files_preview({
        state: options.get_planning_state(),
        candidates,
      });
      if (import_preview.importable_files.length === 0) {
        push_error_toast(
          options.t("app.feedback.operation_failed"),
          options.t("workbench_page.feedback.no_valid_file"),
        );
        return;
      }

      const pending_request: PendingImportFilesRequest = {
        candidates,
        conflict_action: null,
        source_paths: normalized_source_paths,
        files_revision,
      };
      // NEW 入口内隐式处理同名：有冲突先确认策略，没有冲突直接进入继承确认。
      if (import_preview.conflicting_files.length > 0) {
        open_import_conflict_dialog(pending_request, import_preview);
        return;
      }

      open_import_inheritance_dialog(pending_request, "skip", import_preview);
    },
    [open_import_conflict_dialog, open_import_inheritance_dialog, options],
  );

  /**
   * 最终提交前核对文件修订，文件集合变化后重新准备名称。
   */
  const execute_import_files_request = useCallback(
    async (
      pending_request: PendingImportFilesRequest,
      inheritance_mode: "none" | "inherit",
    ): Promise<void> => {
      // 文件修订固定名称归属，条目修订仍取提交时的最新快照。
      const state = options.get_planning_state();
      const preview = create_workbench_import_files_preview({
        state,
        candidates: pending_request.candidates,
      });
      if ((state.section_revisions.files ?? 0) !== pending_request.files_revision) {
        await request_add_files_from_paths(pending_request.source_paths);
        return;
      }

      const conflict_action =
        pending_request.conflict_action ?? (preview.conflicting_files.length > 0 ? null : "skip");
      if (conflict_action === null) {
        open_import_conflict_dialog(pending_request, preview);
        return;
      }

      const files_to_import =
        conflict_action === "replace" ? preview.importable_files : preview.new_files;
      if (files_to_import.length === 0) {
        set_pending_import_files_request(null);
        options.set_dialog_state(close_dialog_state());
        return;
      }

      const import_plan = create_workbench_import_files_plan({
        state,
        candidates: pending_request.candidates,
        conflict_action,
        settings: options.planner_settings,
        inheritance_mode,
      });
      let import_payload: ProjectWriteResultPayload;
      try {
        import_payload = await options.run_modal_progress_toast({
          message: options.t("workbench_page.feedback.add_file_loading_toast"),
          task: () =>
            options.run_project_file_write(import_plan, (body) =>
              api_fetch<ProjectWriteResultPayload>("/api/workbench/files/import", body),
            ),
        });
      } catch (error) {
        if (!(error instanceof DesktopApiError) || error.code !== "data.revision_conflict")
          throw error;
        await request_add_files_from_paths(pending_request.source_paths);
        return;
      }
      const failure_toast = format_source_file_parse_failure_toast(import_payload.failed_files);
      if (failure_toast !== null) {
        options.push_toast("warning", failure_toast);
      }
      set_pending_import_files_request(null);
      options.set_dialog_state(close_dialog_state());
    },
    [open_import_conflict_dialog, options, request_add_files_from_paths],
  );

  /**
   * 接受同名策略时只推进状态机，不在冲突对话阶段直接写库。
   */
  const accept_import_conflict_action = useCallback(
    async (conflict_action: WorkbenchFileConflictAction): Promise<void> => {
      // 策略确认时只推进到继承确认；真正写库必须等继承意图也确定。
      const pending_request = pending_import_files_request;
      if (pending_request === null) {
        options.set_dialog_submitting(false);
        return;
      }

      const preview = create_workbench_import_files_preview({
        state: options.get_planning_state(),
        candidates: pending_request.candidates,
      });
      if (
        (options.get_planning_state().section_revisions.files ?? 0) !==
        pending_request.files_revision
      ) {
        await request_add_files_from_paths(pending_request.source_paths);
        return;
      }

      open_import_inheritance_dialog(pending_request, conflict_action, preview);
    },
    [
      open_import_inheritance_dialog,
      options,
      pending_import_files_request,
      request_add_files_from_paths,
    ],
  );

  /**
   * 单文件入口复用批量导入流程，保持拖放和文件选择行为一致。
   */
  const request_add_file_from_path = useCallback(
    async (source_path: string): Promise<void> => {
      await request_add_files_from_paths([source_path]);
    },
    [request_add_files_from_paths],
  );

  /**
   * 处理导入相关主按钮；返回 true 表示当前对话已被导入流程消费。
   */
  const confirm_dialog = useCallback(async (): Promise<boolean> => {
    const current_dialog_state = options.dialog_state;
    if (
      current_dialog_state.kind !== "confirm-import-files" &&
      current_dialog_state.kind !== "inherit-import-files"
    ) {
      return false;
    }
    if (current_dialog_state.submitting) {
      return true;
    }

    options.set_dialog_submitting(true);
    try {
      if (current_dialog_state.kind === "confirm-import-files") {
        await accept_import_conflict_action("replace");
        return true;
      }

      if (pending_import_files_request === null) {
        options.set_dialog_submitting(false);
        return true;
      }

      await execute_import_files_request(pending_import_files_request, "inherit");
      return true;
    } catch (error) {
      push_error_toast(
        options.t("app.feedback.operation_failed"),
        format_source_file_parse_failure_error_toast(error) ?? error,
      );
      options.set_dialog_submitting(false);
      return true;
    }
  }, [
    accept_import_conflict_action,
    execute_import_files_request,
    options,
    pending_import_files_request,
  ]);

  /** 处理导入冲突的跳过动作，或继承询问中的不填充动作。 */
  const secondary_dialog = useCallback(async (): Promise<boolean> => {
    const current_dialog_state = options.dialog_state;
    if (
      current_dialog_state.kind !== "confirm-import-files" &&
      current_dialog_state.kind !== "inherit-import-files"
    ) {
      return false;
    }
    if (current_dialog_state.submitting) {
      return true;
    }

    if (current_dialog_state.kind === "confirm-import-files") {
      options.set_dialog_submitting(true);
      try {
        await accept_import_conflict_action("skip");
      } catch (error) {
        push_error_toast(options.t("app.feedback.operation_failed"), error);
        options.set_dialog_submitting(false);
      }
      return true;
    }

    if (pending_import_files_request === null) {
      options.set_dialog_state(close_dialog_state());
      return true;
    }

    options.set_dialog_submitting(true);
    try {
      await execute_import_files_request(pending_import_files_request, "none");
    } catch (error) {
      push_error_toast(
        options.t("app.feedback.operation_failed"),
        format_source_file_parse_failure_error_toast(error) ?? error,
      );
      options.set_dialog_submitting(false);
    }
    return true;
  }, [
    accept_import_conflict_action,
    execute_import_files_request,
    options,
    pending_import_files_request,
  ]);

  /**
   * 关闭导入相关对话并丢弃待提交请求，提交中则只消费关闭事件。
   */
  const close_dialog = useCallback((): boolean => {
    if (
      options.dialog_state.kind !== "confirm-import-files" &&
      options.dialog_state.kind !== "inherit-import-files"
    ) {
      return false;
    }
    if (options.dialog_state.submitting) {
      return true;
    }

    set_pending_import_files_request(null);
    options.set_dialog_state(close_dialog_state());
    return true;
  }, [options]);

  return {
    request_add_files_from_paths,
    request_add_file_from_path,
    confirm_dialog,
    secondary_dialog,
    close_dialog,
  };
}
