import type { ProofreadingProjectWriteRunner } from "./proofreading-page-state-contract";
import { is_proofreading_page_row_id } from "@shared/proofreading/proofreading-types";
import { useCallback, useState } from "react";

import type { ItemManualStatus } from "@domain/item";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { BatchTranslationSnapshot } from "@domain/batch-translation";
import { normalize_batch_translation_snapshot } from "@shared/batch-translation/batch-translation";

import type { TextResolver } from "@shared/i18n";
import { PROOFREADING_STATUS_LABEL_KEY_BY_CODE } from "@frontend/features/proofreading/proofreading-label-keys";
import {
  create_clear_translations_plan,
  create_apply_item_changes_plan,
  type ProofreadingCommandItemSnapshot,
} from "@shared/proofreading/proofreading-command-planner";
import type {
  ProofreadingConfirmationAction,
  ProofreadingPendingConfirmation,
} from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import type { ProjectDataSectionRevisions } from "@shared/project-event";

type RetranslateTaskAck = {
  accepted?: boolean;
  batch_translation?: Partial<BatchTranslationSnapshot> & Record<string, unknown>;
};

type UseProofreadingBatchActionsOptions = {
  readonly: boolean;
  is_refreshing: boolean;
  is_writing: boolean;
  dialog_open: boolean;
  list_revisions: ProjectDataSectionRevisions; // 当前校对列表已经消费的项目、质量和校对事实锁
  read_items_by_row_ids: (row_ids: string[]) => Promise<ProofreadingCommandItemSnapshot[]>;
  sync_task_snapshot: (snapshot: BatchTranslationSnapshot) => void;
  run_project_write: ProofreadingProjectWriteRunner;
  set_is_writing: (next_is_writing: boolean) => void;
  resolve_preferred_row_id: (preferred_row_id?: string | null) => string | null;
  remember_preferred_row_id: (preferred_row_id: string | null) => void;
  close_edit_dialog: () => void;
  handle_api_error: (error: unknown, fallback_message: string) => void;
  t: TextResolver;
};

type UseProofreadingBatchActionsResult = {
  pending_confirmation: ProofreadingPendingConfirmation | null;
  request_retranslate_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_clear_translation_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_set_translation_status_row_ids: (
    row_ids: string[],
    status: ItemManualStatus,
    preferred_row_id?: string | null,
  ) => void;
  confirm_pending_confirmation: (action: ProofreadingConfirmationAction) => Promise<void>;
  close_pending_confirmation: () => void;
  clear_pending_confirmation: () => void;
};

/** 文本快照拥有写入身份，列表 row_id 不参与数值转换。 */
function read_item_ids(items: ProofreadingCommandItemSnapshot[]): number[] {
  return [...new Set(items.map((item) => Number(item.item_id)))];
}

// 校对页批量动作的唯一归宿：高风险动作先确认，状态设置保持直接提交。
export function useProofreadingBatchActions(
  options: UseProofreadingBatchActionsOptions,
): UseProofreadingBatchActionsResult {
  const {
    readonly,
    is_refreshing,
    is_writing,
    dialog_open,
    list_revisions,
    read_items_by_row_ids,
    sync_task_snapshot,
    run_project_write,
    set_is_writing,
    resolve_preferred_row_id,
    remember_preferred_row_id,
    close_edit_dialog,
    handle_api_error,
    t,
  } = options;
  const [pending_confirmation, set_pending_confirmation] =
    useState<ProofreadingPendingConfirmation | null>(null);

  /** 批量写入口同时检查文本身份、运行占用与刷新状态。 */
  const can_request_action = useCallback(
    (row_ids: string[]): boolean => {
      return (
        row_ids.length > 0 &&
        row_ids.every((id) => !is_proofreading_page_row_id(id)) &&
        !readonly &&
        !is_refreshing &&
        !is_writing
      );
    },
    [is_writing, is_refreshing, readonly],
  );

  // 提交前回读文本身份，读取失败统一反馈并终止本次写入。
  const read_text_items = useCallback(
    async (row_ids: string[]): Promise<ProofreadingCommandItemSnapshot[]> => {
      try {
        return await read_items_by_row_ids(row_ids);
      } catch (error) {
        handle_api_error(error, t("proofreading_page.feedback.selection_failed"));
        return [];
      }
    },
    [read_items_by_row_ids, handle_api_error, t],
  );

  /** 受理重翻任务后同步运行态并结束当前编辑。 */
  const submit_retranslate_row_ids = useCallback(
    async (row_ids: string[], preferred_row_id: string | null): Promise<void> => {
      const item_ids = read_item_ids(await read_text_items(row_ids));
      if (item_ids.length === 0) {
        return;
      }

      remember_preferred_row_id(resolve_preferred_row_id(preferred_row_id));
      set_is_writing(true);
      try {
        const ack = await api_fetch<RetranslateTaskAck>("/api/batch-translation/start", {
          operation: "retranslate",
          scope: { kind: "items", item_ids },
        });
        sync_task_snapshot(normalize_batch_translation_snapshot(ack));
        if (dialog_open) {
          close_edit_dialog();
        }
      } catch (error) {
        handle_api_error(error, t("proofreading_page.feedback.retranslate_failed"));
      } finally {
        set_is_writing(false);
      }
    },
    [
      read_text_items,
      close_edit_dialog,
      dialog_open,
      handle_api_error,
      remember_preferred_row_id,
      resolve_preferred_row_id,
      set_is_writing,
      sync_task_snapshot,
      t,
    ],
  );

  /** 清空提交成功后结束当前编辑，失败交由写入入口反馈。 */
  const submit_clear_translation_row_ids = useCallback(
    async (
      row_ids: string[],
      preferred_row_id: string | null,
      reset_status: boolean,
    ): Promise<void> => {
      const target_item_ids = read_item_ids(await read_text_items(row_ids));
      if (target_item_ids.length === 0) {
        return;
      }

      const result = await run_project_write({
        path: "/api/proofreading/translations/clear",
        plan: create_clear_translations_plan({
          section_revisions: list_revisions,
          item_ids: target_item_ids,
          reset_status,
        }),
        fallback_error_key: "proofreading_page.feedback.clear_translation_failed",
        preferred_row_id,
        success_message_builder: (changed_count) => {
          const feedback_key = reset_status
            ? "proofreading_page.feedback.clear_translation_and_reset_status_success"
            : "proofreading_page.feedback.clear_translation_success";
          return t(feedback_key).replace("{COUNT}", changed_count.toString());
        },
      });
      if (result && dialog_open) close_edit_dialog();
    },
    [close_edit_dialog, dialog_open, list_revisions, read_text_items, run_project_write, t],
  );

  /** 人工状态提交成功后结束当前编辑。 */
  const submit_set_translation_status_row_ids = useCallback(
    async (
      row_ids: string[],
      status: ItemManualStatus,
      preferred_row_id: string | null,
    ): Promise<void> => {
      const items = await read_text_items(row_ids);
      const target_item_ids = read_item_ids(items);
      if (target_item_ids.length === 0) {
        return;
      }

      const status_label = t(PROOFREADING_STATUS_LABEL_KEY_BY_CODE[status]);
      const result = await run_project_write({
        path: "/api/proofreading/items/update",
        plan: create_apply_item_changes_plan({
          snapshot: {
            items,
            section_revisions: list_revisions,
          },
          changes: target_item_ids.map((item_id) => ({ item_id, status })),
        }),
        fallback_error_key: "app.feedback.modify_failed",
        preferred_row_id,
        success_message_builder: (changed_count) => {
          return t("proofreading_page.feedback.set_status_success")
            .replace("{COUNT}", changed_count.toString())
            .replace("{STATUS}", status_label);
        },
      });
      if (result && dialog_open) close_edit_dialog();
    },
    [close_edit_dialog, dialog_open, list_revisions, read_text_items, run_project_write, t],
  );

  /** 重翻先登记待确认范围，确认后再受理任务。 */
  const request_retranslate_row_ids = useCallback(
    (row_ids: string[], preferred_row_id?: string | null): void => {
      if (!can_request_action(row_ids)) {
        return;
      }

      set_pending_confirmation({
        kind: "retranslate",
        target_row_ids: [...row_ids],
        preferred_row_id: resolve_preferred_row_id(preferred_row_id),
        submitting_action: null,
      });
    },
    [can_request_action, resolve_preferred_row_id],
  );

  /** 清空操作记录确认范围，保留发起时的焦点。 */
  const request_clear_translation_row_ids = useCallback(
    (row_ids: string[], preferred_row_id?: string | null): void => {
      if (!can_request_action(row_ids)) {
        return;
      }

      set_pending_confirmation({
        kind: "clear-translations",
        target_row_ids: [...row_ids],
        preferred_row_id: resolve_preferred_row_id(preferred_row_id),
        submitting_action: null,
      });
    },
    [can_request_action, resolve_preferred_row_id],
  );

  /** 人工状态直接提交，复用共享写入与焦点恢复。 */
  const request_set_translation_status_row_ids = useCallback(
    (row_ids: string[], status: ItemManualStatus, preferred_row_id?: string | null): void => {
      if (!can_request_action(row_ids)) {
        return;
      }

      void submit_set_translation_status_row_ids(
        row_ids,
        status,
        resolve_preferred_row_id(preferred_row_id),
      );
    },
    [can_request_action, resolve_preferred_row_id, submit_set_translation_status_row_ids],
  );

  /** 提交中的确认保持可见，等待受理或失败反馈完成。 */
  const close_pending_confirmation = useCallback((): void => {
    set_pending_confirmation((previous_confirmation) => {
      return previous_confirmation?.submitting_action === null ? null : previous_confirmation;
    });
  }, []);

  /** 工程边界切换时撤销旧确认范围。 */
  const clear_pending_confirmation = useCallback((): void => {
    set_pending_confirmation(null);
  }, []);

  /** 确认动作与已登记操作匹配后，提交并释放确认状态。 */
  const confirm_pending_confirmation = useCallback(
    async (action: ProofreadingConfirmationAction): Promise<void> => {
      if (pending_confirmation === null || pending_confirmation.submitting_action !== null) {
        return;
      }

      const action_matches_confirmation =
        pending_confirmation.kind === "retranslate"
          ? action === "retranslate"
          : action !== "retranslate";
      if (!action_matches_confirmation) return;

      const confirmation_to_submit = pending_confirmation;
      set_pending_confirmation({
        ...confirmation_to_submit,
        submitting_action: action,
      });
      try {
        if (action === "retranslate") {
          await submit_retranslate_row_ids(
            confirmation_to_submit.target_row_ids,
            confirmation_to_submit.preferred_row_id,
          );
        } else {
          await submit_clear_translation_row_ids(
            confirmation_to_submit.target_row_ids,
            confirmation_to_submit.preferred_row_id,
            action === "clear-translations-and-reset-status",
          );
        }
      } finally {
        set_pending_confirmation(null);
      }
    },
    [pending_confirmation, submit_clear_translation_row_ids, submit_retranslate_row_ids],
  );

  return {
    pending_confirmation,
    request_retranslate_row_ids,
    request_clear_translation_row_ids,
    request_set_translation_status_row_ids,
    confirm_pending_confirmation,
    close_pending_confirmation,
    clear_pending_confirmation,
  };
}
