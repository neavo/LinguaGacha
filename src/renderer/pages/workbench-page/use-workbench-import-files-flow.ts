import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { ProjectPagesBarrierCheckpoint } from "@/app/page-runtime/project-pages-barrier";
import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProjectMutationResultPayload } from "@/app/desktop/desktop-project-mutation";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";
import type { LocaleKey } from "@/app/locale/locale-provider";
import type { ProjectStoreReader } from "@/project/store/project-store";
import { resolve_visible_error_message } from "@/app/ui-runtime/error-message";
import { normalize_source_paths } from "@/lib/source-paths";
import {
  format_source_file_parse_failure_error_toast,
  format_source_file_parse_failure_toast,
} from "@/lib/source-file-parse-failure-toast";
import {
  create_workbench_import_files_plan,
  create_workbench_import_files_preview,
  type WorkbenchFileConflictAction,
  type WorkbenchFileParsePreview,
  type WorkbenchImportFilesPreview,
  type WorkbenchPlannerSettings,
  type WorkbenchProjectMutationPlan,
} from "@/pages/workbench-page/workbench-mutation-planner";
import type { WorkbenchDialogState } from "@/pages/workbench-page/types";

type PendingImportFilesRequest = {
  parsed_files: WorkbenchFileParsePreview[]; // parsed_files 是 Core 预解析后的文件草稿，不作为最终项目事实
  barrier_checkpoint: ProjectPagesBarrierCheckpoint | null;
  conflict_action: WorkbenchFileConflictAction | null;
  conflict_signature: string; // conflict_signature 用于识别对话期间 ProjectStore 是否变化
};

type WorkbenchImportFlowToastKind = "info" | "success" | "warning" | "error";

type WorkbenchImportFilesFlowOptions = {
  readonly: boolean;
  project_identity: string;
  dialog_state: WorkbenchDialogState;
  project_store: ProjectStoreReader;
  task_snapshot: TaskSnapshot;
  planner_settings: WorkbenchPlannerSettings; // 导入命令只需要预过滤设置，不依赖完整应用设置快照
  createProjectPagesBarrierCheckpoint?: () => ProjectPagesBarrierCheckpoint;
  run_modal_progress_toast: <T>(args: {
    message: string;
    task: () => Promise<T>;
    timeout_ms?: number;
  }) => Promise<T>;
  run_project_file_mutation: (
    plan: WorkbenchProjectMutationPlan,
    request: (body: Record<string, unknown>) => Promise<ProjectMutationResultPayload>,
    barrier_checkpoint: ProjectPagesBarrierCheckpoint | null,
  ) => Promise<ProjectMutationResultPayload>;
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
  cancel_dialog: () => Promise<boolean>;
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
 * 收窄 Core 预解析响应中的单个文件草稿，避免脏 payload 进入导入状态机。
 */
function normalize_workbench_file_parse_preview(payload: {
  source_path?: unknown;
  target_rel_path?: unknown;
  file_type?: unknown;
  parsed_items?: unknown;
}): WorkbenchFileParsePreview {
  return {
    source_path: String(payload.source_path ?? ""),
    target_rel_path: String(payload.target_rel_path ?? ""),
    file_type: String(payload.file_type ?? "NONE"),
    parsed_items: Array.isArray(payload.parsed_items)
      ? payload.parsed_items.flatMap((item) => {
          return typeof item === "object" && item !== null
            ? [{ ...(item as Record<string, unknown>) }]
            : [];
        })
      : [],
  };
}

/**
 * 工作台导入文件流程集中管理预解析、冲突确认、继承确认和最终提交。
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
   * 打开同名冲突确认对话框，并保存当前冲突签名用于后续二次校验。
   */
  const open_import_conflict_dialog = useCallback(
    (pending_request: PendingImportFilesRequest, preview: WorkbenchImportFilesPreview): void => {
      // 同名确认只保存用户决策上下文，不把预演结果当作最终项目事实。
      set_pending_import_files_request({
        ...pending_request,
        conflict_action: null,
        conflict_signature: preview.conflict_signature,
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
        conflict_signature: preview.conflict_signature,
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
   * 最终提交前重新预演同名冲突，保证对话期间的项目变化不会被旧判断覆盖。
   */
  const execute_import_files_request = useCallback(
    async (
      pending_request: PendingImportFilesRequest,
      inheritance_mode: "none" | "inherit",
    ): Promise<void> => {
      // 提交前重新基于 ProjectStore 预演，避免对话期间项目事实变化后沿用旧同名判断。
      const state = options.project_store.getState();
      const preview = create_workbench_import_files_preview({
        state,
        parsed_files: pending_request.parsed_files,
      });
      if (
        preview.conflicting_files.length > 0 &&
        preview.conflict_signature !== pending_request.conflict_signature
      ) {
        open_import_conflict_dialog(pending_request, preview);
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
        task_snapshot: options.task_snapshot,
        parsed_files: pending_request.parsed_files,
        conflict_action,
        settings: options.planner_settings,
        inheritance_mode,
      });
      const import_payload = await options.run_project_file_mutation(
        import_plan,
        async (body) => {
          return await api_fetch<ProjectMutationResultPayload>(
            "/api/project/workbench/import-files",
            body,
          );
        },
        pending_request.barrier_checkpoint,
      );
      const failure_toast = format_source_file_parse_failure_toast({
        value: (import_payload as { failed_files?: unknown }).failed_files,
        text: options.t,
      });
      if (failure_toast !== null) {
        options.push_toast("warning", failure_toast);
      }
      set_pending_import_files_request(null);
      options.set_dialog_state(close_dialog_state());
    },
    [open_import_conflict_dialog, options],
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
        state: options.project_store.getState(),
        parsed_files: pending_request.parsed_files,
      });
      if (preview.conflict_signature !== pending_request.conflict_signature) {
        open_import_conflict_dialog(pending_request, preview);
        return;
      }

      open_import_inheritance_dialog(pending_request, conflict_action, preview);
    },
    [
      open_import_conflict_dialog,
      open_import_inheritance_dialog,
      options,
      pending_import_files_request,
    ],
  );

  /**
   * 解析用户选择的源路径，按冲突情况进入策略确认或继承确认。
   */
  const request_add_files_from_paths = useCallback(
    async (source_paths: string[]): Promise<void> => {
      if (options.readonly) {
        return;
      }

      const normalized_source_paths = normalize_source_paths(source_paths);
      if (normalized_source_paths.length === 0) {
        options.push_toast("error", options.t("workbench_page.feedback.no_valid_file"));
        return;
      }

      const barrier_checkpoint = options.createProjectPagesBarrierCheckpoint?.() ?? null;
      const parsed_files: WorkbenchFileParsePreview[] = [];
      let parse_failure_toast_shown = false; // parse_failure_toast_shown 防止全失败时再叠加泛错误

      await options.run_modal_progress_toast({
        message: options.t("workbench_page.feedback.add_file_loading_toast"),
        task: async () => {
          const payload = await api_fetch<{ files?: unknown }>(
            "/api/project/workbench/parse-file",
            {
              source_paths: normalized_source_paths,
            },
          );
          const preview_files = Array.isArray(payload.files) ? payload.files : [];
          const raw_failed_files = (payload as { failed_files?: unknown }).failed_files;

          for (const preview_file of preview_files) {
            if (typeof preview_file !== "object" || preview_file === null) {
              continue;
            }

            const parsed_file = normalize_workbench_file_parse_preview(
              preview_file as Record<string, unknown>,
            );
            if (
              parsed_file.source_path.trim() === "" ||
              parsed_file.target_rel_path.trim() === ""
            ) {
              continue;
            }
            parsed_files.push({
              ...parsed_file,
              source_path: parsed_file.source_path.trim(),
              target_rel_path: parsed_file.target_rel_path.trim(),
            });
          }

          const failure_toast = format_source_file_parse_failure_toast({
            value: raw_failed_files,
            text: options.t,
          });
          if (failure_toast !== null) {
            options.push_toast(parsed_files.length > 0 ? "warning" : "error", failure_toast);
            parse_failure_toast_shown = true;
          }
        },
      });

      const import_preview = create_workbench_import_files_preview({
        state: options.project_store.getState(),
        parsed_files,
      });
      if (import_preview.importable_files.length === 0) {
        if (parsed_files.length === 0 && parse_failure_toast_shown) {
          return;
        }
        options.push_toast("error", options.t("workbench_page.feedback.no_valid_file"));
        return;
      }

      const pending_request: PendingImportFilesRequest = {
        parsed_files,
        barrier_checkpoint,
        conflict_action: null,
        conflict_signature: import_preview.conflict_signature,
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
      const parse_failure_toast = format_source_file_parse_failure_error_toast({
        error,
        text: options.t,
      });
      if (parse_failure_toast !== null) {
        options.push_toast("error", parse_failure_toast);
        options.set_dialog_submitting(false);
        return true;
      }
      options.push_toast(
        "error",
        resolve_visible_error_message(
          error,
          options.t,
          options.t("workbench_page.feedback.file_action_failed"),
        ),
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

  /**
   * 处理导入冲突对话的次按钮；当前语义为跳过同名文件。
   */
  const secondary_dialog = useCallback(async (): Promise<boolean> => {
    const current_dialog_state = options.dialog_state;
    if (current_dialog_state.kind !== "confirm-import-files") {
      return false;
    }
    if (current_dialog_state.submitting) {
      return true;
    }

    options.set_dialog_submitting(true);
    try {
      await accept_import_conflict_action("skip");
    } catch (error) {
      options.push_toast(
        "error",
        resolve_visible_error_message(
          error,
          options.t,
          options.t("workbench_page.feedback.file_action_failed"),
        ),
      );
      options.set_dialog_submitting(false);
    }
    return true;
  }, [accept_import_conflict_action, options]);

  /**
   * 处理导入相关取消按钮；继承确认的取消表示不继承但继续导入。
   */
  const cancel_dialog = useCallback(async (): Promise<boolean> => {
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
      set_pending_import_files_request(null);
      options.set_dialog_state(close_dialog_state());
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
      const parse_failure_toast = format_source_file_parse_failure_error_toast({
        error,
        text: options.t,
      });
      if (parse_failure_toast !== null) {
        options.push_toast("error", parse_failure_toast);
        options.set_dialog_submitting(false);
        return true;
      }
      options.push_toast(
        "error",
        resolve_visible_error_message(
          error,
          options.t,
          options.t("workbench_page.feedback.file_action_failed"),
        ),
      );
      options.set_dialog_submitting(false);
    }
    return true;
  }, [execute_import_files_request, options, pending_import_files_request]);

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
    cancel_dialog,
    close_dialog,
  };
}
