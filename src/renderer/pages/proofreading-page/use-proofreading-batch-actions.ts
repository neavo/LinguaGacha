import { useCallback, useState } from "react";

import { api_fetch } from "@/app/desktop/desktop-api";
import { normalize_task_snapshot, type TaskSnapshot } from "@/app/desktop/task-runtime-store";
import type { LocaleKey } from "@/app/locale/locale-provider";
import type { ProjectStoreReader } from "@/project/store/project-store";
import {
  create_clear_translations_plan,
  create_set_translation_status_plan,
  type ProofreadingMutationPlan,
} from "@/pages/proofreading-page/proofreading-mutation-planner";
import {
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  type ProofreadingManualStatusCode,
  type ProofreadingPendingConfirmation,
} from "@/pages/proofreading-page/types";

type LocaleTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

type ProofreadingProjectMutationRunner = (args: {
  path: string;
  plan: ProofreadingMutationPlan | null;
  fallback_error_key:
    | "proofreading_page.feedback.clear_translation_failed"
    | "proofreading_page.feedback.set_status_failed";
  preferred_row_id?: string | null;
  success_message_builder?: ((changed_count: number) => string) | null;
  empty_warning_message?: string | null;
  close_dialog?: boolean;
}) => Promise<void>;

type RetranslateTaskAck = {
  accepted?: boolean;
  task?: Partial<TaskSnapshot> & Record<string, unknown>;
};

type UseProofreadingBatchActionsOptions = {
  readonly: boolean;
  is_refreshing: boolean;
  is_mutating: boolean;
  dialog_open: boolean;
  project_store: ProjectStoreReader;
  task_snapshot: TaskSnapshot;
  proofreading_revision: number;
  sync_task_snapshot: (snapshot: TaskSnapshot) => void;
  run_project_mutation: ProofreadingProjectMutationRunner;
  set_is_mutating: (next_is_mutating: boolean) => void;
  resolve_preferred_row_id: (preferred_row_id?: string | null) => string | null;
  remember_preferred_row_id: (preferred_row_id: string | null) => void;
  close_edit_dialog: () => void;
  handle_api_error: (error: unknown, fallback_message: string) => void;
  t: LocaleTextResolver;
};

type UseProofreadingBatchActionsResult = {
  pending_confirmation: ProofreadingPendingConfirmation | null;
  request_retranslate_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_clear_translation_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_set_translation_status_row_ids: (
    row_ids: string[],
    status: ProofreadingManualStatusCode,
    preferred_row_id?: string | null,
  ) => void;
  confirm_pending_confirmation: () => Promise<void>;
  close_pending_confirmation: () => void;
  clear_pending_confirmation: () => void;
};

function normalize_numeric_item_ids(raw_item_ids: unknown): number[] {
  if (!Array.isArray(raw_item_ids)) {
    return [];
  }

  // 用户选择、确认状态与任务回执都可能携带行 id；提交前统一收窄为后端 item_id。
  const item_ids: number[] = [];
  const seen_ids = new Set<number>();
  raw_item_ids.forEach((raw_item_id) => {
    const item_id = Number(raw_item_id);
    if (!Number.isInteger(item_id) || item_id <= 0 || seen_ids.has(item_id)) {
      return;
    }

    seen_ids.add(item_id);
    item_ids.push(item_id);
  });
  return item_ids;
}

function build_retranslate_task_snapshot(args: {
  ack: RetranslateTaskAck;
  current_task_snapshot: TaskSnapshot;
  requested_item_ids: number[];
}): TaskSnapshot {
  const task_payload = args.ack.task ?? {};
  const normalized_snapshot = normalize_task_snapshot({ task: task_payload });
  const normalized_scope =
    normalized_snapshot.extras.kind === "translation" ? normalized_snapshot.extras.scope : null;
  const item_scope =
    normalized_scope?.kind === "items" && normalized_scope.item_ids.length > 0
      ? normalized_scope
      : { kind: "items" as const, item_ids: args.requested_item_ids };

  // 启动回执允许只返回增量字段；缺失字段按“已请求重翻指定条目”的前端运行态语义补齐。
  return {
    ...normalized_snapshot,
    runtime_revision:
      task_payload.runtime_revision === undefined
        ? args.current_task_snapshot.runtime_revision
        : normalized_snapshot.runtime_revision,
    task_type: task_payload.task_type === undefined ? "translation" : normalized_snapshot.task_type,
    status: task_payload.status === undefined ? "requested" : normalized_snapshot.status,
    busy: task_payload.busy === undefined ? true : normalized_snapshot.busy,
    extras: {
      kind: "translation",
      scope: item_scope,
    },
  };
}

// 校对页批量动作的唯一归宿：高风险动作先确认，状态设置保持直接提交。
export function useProofreadingBatchActions(
  options: UseProofreadingBatchActionsOptions,
): UseProofreadingBatchActionsResult {
  const {
    readonly,
    is_refreshing,
    is_mutating,
    dialog_open,
    project_store,
    task_snapshot,
    proofreading_revision,
    sync_task_snapshot,
    run_project_mutation,
    set_is_mutating,
    resolve_preferred_row_id,
    remember_preferred_row_id,
    close_edit_dialog,
    handle_api_error,
    t,
  } = options;
  const [pending_confirmation, set_pending_confirmation] =
    useState<ProofreadingPendingConfirmation | null>(null);

  const can_request_action = useCallback(
    (row_ids: string[]): boolean => {
      return row_ids.length > 0 && !readonly && !is_refreshing && !is_mutating;
    },
    [is_mutating, is_refreshing, readonly],
  );

  const submit_retranslate_row_ids = useCallback(
    async (row_ids: string[], preferred_row_id: string | null): Promise<void> => {
      const item_ids = normalize_numeric_item_ids(row_ids);
      if (item_ids.length === 0) {
        return;
      }

      remember_preferred_row_id(resolve_preferred_row_id(preferred_row_id));
      set_is_mutating(true);
      try {
        const current_project_state = project_store.getState();
        const ack = await api_fetch<RetranslateTaskAck>("/api/tasks/start", {
          task_type: "translation",
          mode: "new",
          scope: { kind: "items", item_ids },
          expected_section_revisions: {
            items: current_project_state.revisions.sections.items ?? 0,
            proofreading: proofreading_revision,
            quality: current_project_state.revisions.sections.quality ?? 0,
            prompts: current_project_state.revisions.sections.prompts ?? 0,
          },
        });
        sync_task_snapshot(
          build_retranslate_task_snapshot({
            ack,
            current_task_snapshot: task_snapshot,
            requested_item_ids: item_ids,
          }),
        );
        if (dialog_open) {
          close_edit_dialog();
        }
      } catch (error) {
        handle_api_error(error, t("proofreading_page.feedback.retranslate_failed"));
      } finally {
        set_is_mutating(false);
      }
    },
    [
      close_edit_dialog,
      dialog_open,
      handle_api_error,
      project_store,
      proofreading_revision,
      remember_preferred_row_id,
      resolve_preferred_row_id,
      set_is_mutating,
      sync_task_snapshot,
      t,
      task_snapshot,
    ],
  );

  const submit_clear_translation_row_ids = useCallback(
    async (row_ids: string[], preferred_row_id: string | null): Promise<void> => {
      const target_item_ids = normalize_numeric_item_ids(row_ids);
      if (target_item_ids.length === 0) {
        return;
      }

      await run_project_mutation({
        path: "/api/project/proofreading/clear-translations",
        plan: create_clear_translations_plan({
          state: project_store.getState(),
          task_snapshot,
          item_ids: target_item_ids,
        }),
        fallback_error_key: "proofreading_page.feedback.clear_translation_failed",
        preferred_row_id,
        success_message_builder: (changed_count) => {
          return t("proofreading_page.feedback.clear_translation_success")
            .replace("{COUNT}", changed_count.toString());
        },
        close_dialog: dialog_open,
        empty_warning_message: null,
      });
    },
    [dialog_open, project_store, run_project_mutation, t, task_snapshot],
  );

  const submit_set_translation_status_row_ids = useCallback(
    async (
      row_ids: string[],
      status: ProofreadingManualStatusCode,
      preferred_row_id: string | null,
    ): Promise<void> => {
      const target_item_ids = normalize_numeric_item_ids(row_ids);
      if (target_item_ids.length === 0) {
        return;
      }

      const status_label = t(PROOFREADING_STATUS_LABEL_KEY_BY_CODE[status]);
      await run_project_mutation({
        path: "/api/project/proofreading/set-status",
        plan: create_set_translation_status_plan({
          state: project_store.getState(),
          task_snapshot,
          item_ids: target_item_ids,
          status,
        }),
        fallback_error_key: "proofreading_page.feedback.set_status_failed",
        preferred_row_id,
        success_message_builder: (changed_count) => {
          return t("proofreading_page.feedback.set_status_success")
            .replace("{COUNT}", changed_count.toString())
            .replace("{STATUS}", status_label);
        },
        close_dialog: dialog_open,
        empty_warning_message: null,
      });
    },
    [dialog_open, project_store, run_project_mutation, t, task_snapshot],
  );

  const request_retranslate_row_ids = useCallback(
    (row_ids: string[], preferred_row_id?: string | null): void => {
      if (!can_request_action(row_ids)) {
        return;
      }

      set_pending_confirmation({
        kind: "retranslate",
        target_row_ids: [...row_ids],
        preferred_row_id: resolve_preferred_row_id(preferred_row_id),
        submitting: false,
      });
    },
    [can_request_action, resolve_preferred_row_id],
  );

  const request_clear_translation_row_ids = useCallback(
    (row_ids: string[], preferred_row_id?: string | null): void => {
      if (!can_request_action(row_ids)) {
        return;
      }

      set_pending_confirmation({
        kind: "clear-translations",
        target_row_ids: [...row_ids],
        preferred_row_id: resolve_preferred_row_id(preferred_row_id),
        submitting: false,
      });
    },
    [can_request_action, resolve_preferred_row_id],
  );

  const request_set_translation_status_row_ids = useCallback(
    (
      row_ids: string[],
      status: ProofreadingManualStatusCode,
      preferred_row_id?: string | null,
    ): void => {
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

  const close_pending_confirmation = useCallback((): void => {
    set_pending_confirmation((previous_confirmation) => {
      return previous_confirmation?.submitting ? previous_confirmation : null;
    });
  }, []);

  const clear_pending_confirmation = useCallback((): void => {
    set_pending_confirmation(null);
  }, []);

  const confirm_pending_confirmation = useCallback(async (): Promise<void> => {
    if (pending_confirmation === null || pending_confirmation.submitting) {
      return;
    }

    const confirmation_to_submit = pending_confirmation;
    set_pending_confirmation({
      ...confirmation_to_submit,
      submitting: true,
    });
    try {
      if (confirmation_to_submit.kind === "retranslate") {
        await submit_retranslate_row_ids(
          confirmation_to_submit.target_row_ids,
          confirmation_to_submit.preferred_row_id,
        );
      } else {
        await submit_clear_translation_row_ids(
          confirmation_to_submit.target_row_ids,
          confirmation_to_submit.preferred_row_id,
        );
      }
    } finally {
      set_pending_confirmation(null);
    }
  }, [pending_confirmation, submit_clear_translation_row_ids, submit_retranslate_row_ids]);

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
