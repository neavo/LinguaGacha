import { GODOT_PACK_ORDER_REFRESH_ACTION } from "@shared/godot";
import type { GodotPackOrder } from "@shared/godot";
import { useGodotPackOrder } from "@frontend/features/godot-pack-order/use-godot-pack-order";
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
  type WorkbenchFileConflictAction,
  type WorkbenchImportFileCandidate,
  type WorkbenchImportFilesPreview,
  type WorkbenchCommandPlanningState,
  type WorkbenchCommandPlan,
} from "@shared/workbench/workbench-command-planner";
import type { WorkbenchDialogState } from "@frontend/pages/workbench-page/types";

type PendingImportFilesRequest = {
  godot_pack_orders: readonly GodotPackOrder[];
  preview: WorkbenchImportFilesPreview; // 后端拥有目标名称、冲突分类和修订。
  conflict_action: WorkbenchFileConflictAction;
  source_paths: string[];
};

type WorkbenchImportFlowToastKind = "info" | "success" | "warning";

type WorkbenchImportFilesFlowOptions = {
  readonly: boolean;
  project_identity: string;
  dialog_state: WorkbenchDialogState;
  get_planning_state: () => WorkbenchCommandPlanningState;
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
  godot_pack_order: ReturnType<typeof useGodotPackOrder>;
  request_add_files_from_paths: (source_paths: string[]) => Promise<void>;
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
    typeof payload.target_rel_path !== "string" ||
    !("conflict" in payload) ||
    typeof payload.conflict !== "boolean" ||
    payload.source_path.trim() === "" ||
    payload.target_rel_path.trim() === ""
  )
    return null;
  return {
    source_path: payload.source_path,
    target_rel_path: payload.target_rel_path,
    conflict: payload.conflict,
  };
}

/**
 * 工作台导入文件流程集中管理导入预览、冲突确认、继承确认和最终提交。
 */
export function useWorkbenchImportFilesFlow(
  options: WorkbenchImportFilesFlowOptions,
): WorkbenchImportFilesFlow {
  const godot_pack_order = useGodotPackOrder();
  const [pending_import_files_request, set_pending_import_files_request] =
    useState<PendingImportFilesRequest | null>(null);

  useEffect(() => {
    set_pending_import_files_request(null);
    godot_pack_order.finish(null);
  }, [options.project_identity, godot_pack_order.finish]);

  /**
   * 打开译文继承确认对话框，按冲突策略筛出本次真正会导入的文件。
   */
  const open_import_inheritance_dialog = useCallback(
    (
      pending_request: PendingImportFilesRequest,
      conflict_action: WorkbenchFileConflictAction,
    ): void => {
      // 跳过策略只继承新文件；替换策略需要同时展示新增文件和即将重建的同名文件。
      const files_to_import = pending_request.preview.files.filter(
        (file) => conflict_action === "replace" || !file.conflict,
      );
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

      const import_preview = await options.run_modal_progress_toast({
        message: options.t("workbench_page.feedback.add_file_loading_toast"),
        task: async (): Promise<WorkbenchImportFilesPreview> => {
          const payload = await api_fetch<WorkbenchImportFilesPreview>(
            "/api/workbench/files/preview",
            {
              source_paths: normalized_source_paths,
            },
          );
          return {
            ...payload,
            files: Array.isArray(payload.files)
              ? payload.files.flatMap((file) => {
                  const candidate = normalize_workbench_import_candidate(file);
                  return candidate ? [candidate] : [];
                })
              : [],
          };
        },
      });
      if (
        !Number.isSafeInteger(import_preview.files_revision) ||
        import_preview.files_revision < 0 ||
        import_preview.files.length === 0
      ) {
        push_error_toast(
          options.t("app.feedback.operation_failed"),
          options.t("workbench_page.feedback.no_valid_file"),
        );
        return;
      }

      const godot_pack_orders = await godot_pack_order.request_order(import_preview.godot_packs);
      if (godot_pack_orders === null) return;
      const pending_request: PendingImportFilesRequest = {
        godot_pack_orders,
        preview: import_preview,
        conflict_action: "skip",
        source_paths: normalized_source_paths,
      };
      const conflicts = import_preview.files.filter((file) => file.conflict);
      if (conflicts.length > 0) {
        set_pending_import_files_request(pending_request);
        options.set_dialog_state({
          kind: "confirm-import-files",
          target_rel_paths: conflicts.map((file) => file.target_rel_path),
          pending_path: conflicts[0]!.source_path,
          submitting: false,
        });
        return;
      }

      open_import_inheritance_dialog(pending_request, "skip");
    },
    [open_import_inheritance_dialog, options, godot_pack_order.request_order],
  );

  /**
   * 提交用户选择，服务端报告修订冲突时重新预览。
   */
  const execute_import_files_request = useCallback(
    async (
      pending_request: PendingImportFilesRequest,
      inheritance_mode: "none" | "inherit",
    ): Promise<void> => {
      // 文件修订固定名称归属，条目修订仍取提交时的最新快照。
      const state = options.get_planning_state();
      const conflict_action = pending_request.conflict_action;
      const import_plan = create_workbench_import_files_plan({
        state,
        preview: pending_request.preview,
        conflict_action,
        inheritance_mode,
      });
      const selected_paths = new Set(
        pending_request.preview.files
          .filter((file) => conflict_action === "replace" || !file.conflict)
          .flatMap((file) => {
            const value = file.source_path.replaceAll("\\", "/").toLowerCase();
            return [value, value.replace(/\/[^/]+\.exe$/iu, "")];
          }),
      );
      const godot_pack_orders = pending_request.godot_pack_orders.filter((game) =>
        selected_paths.has(game.game_root.replaceAll("\\", "/").toLowerCase()),
      );
      let import_payload: ProjectWriteResultPayload;
      try {
        import_payload = await options.run_modal_progress_toast({
          message: options.t("workbench_page.feedback.add_file_loading_toast"),
          task: () =>
            options.run_project_file_write(import_plan, (body) =>
              api_fetch<ProjectWriteResultPayload>("/api/workbench/files/import", {
                ...body,
                ...(godot_pack_orders.length ? { godot_pack_orders } : {}),
              }),
            ),
        });
      } catch (error) {
        if (
          !(error instanceof DesktopApiError) ||
          (error.code !== "data.revision_conflict" &&
            error.details.action !== GODOT_PACK_ORDER_REFRESH_ACTION)
        )
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
    [options, request_add_files_from_paths],
  );

  /** 两类按钮共享提交与错误处理，阶段只决定用户选择。 */
  const handle_dialog = useCallback(
    async (primary: boolean): Promise<boolean> => {
      const { kind, submitting } = options.dialog_state;
      if (kind !== "confirm-import-files" && kind !== "inherit-import-files") return false;
      if (submitting) return true;
      const pending = pending_import_files_request;
      if (pending === null) {
        options.set_dialog_state(close_dialog_state());
        return true;
      }
      options.set_dialog_submitting(true);
      try {
        if (
          (options.get_planning_state().section_revisions.files ?? 0) !==
          pending.preview.files_revision
        ) {
          await request_add_files_from_paths(pending.source_paths);
        } else if (kind === "confirm-import-files") {
          open_import_inheritance_dialog(pending, primary ? "replace" : "skip");
        } else {
          await execute_import_files_request(pending, primary ? "inherit" : "none");
        }
      } catch (error) {
        push_error_toast(
          options.t("app.feedback.operation_failed"),
          format_source_file_parse_failure_error_toast(error) ?? error,
        );
        options.set_dialog_submitting(false);
      }
      return true;
    },
    [
      execute_import_files_request,
      open_import_inheritance_dialog,
      options,
      pending_import_files_request,
      request_add_files_from_paths,
    ],
  );
  const confirm_dialog = useCallback(() => handle_dialog(true), [handle_dialog]); // 主按钮选择替换或继承。
  const secondary_dialog = useCallback(() => handle_dialog(false), [handle_dialog]); // 次按钮选择跳过或不继承。

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
    godot_pack_order,
    request_add_files_from_paths,
    confirm_dialog,
    secondary_dialog,
    close_dialog,
  };
}
