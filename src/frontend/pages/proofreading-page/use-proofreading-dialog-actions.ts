import { useCallback, useMemo, useState } from "react";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  create_save_item_plan,
  type ProofreadingCommandPlan,
} from "@shared/proofreading/proofreading-command-planner";
import { read_item_name_text } from "@shared/item-name";
import type {
  ProofreadingClientItem,
  ProofreadingItem,
} from "@shared/proofreading/proofreading-types";
import type { ProjectDataSectionRevisions } from "@shared/project-event";
import type { ProofreadingDialogState } from "@frontend/pages/proofreading-page/proofreading-page-ui-types";

type ProofreadingToastPusher = (kind: "success" | "warning" | "error", message: string) => void;

type LocaleTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

type ProofreadingProjectWriteRunner = (args: {
  path: string;
  plan: ProofreadingCommandPlan | null;
  fallback_error_key: "proofreading_page.feedback.save_failed";
  preferred_row_id?: string | null;
  success_message_builder?: ((changed_count: number) => string) | null;
  close_dialog?: boolean;
}) => Promise<void>;

type UseProofreadingDialogActionsOptions = {
  list_revisions: ProjectDataSectionRevisions; // 弹窗保存使用列表 query 已消费的 revision 锁
  visible_item_by_id: Map<string, ProofreadingClientItem>;
  read_items_by_row_ids: (row_ids: string[]) => Promise<ProofreadingClientItem[]>;
  run_project_write: ProofreadingProjectWriteRunner;
  push_toast: ProofreadingToastPusher;
  t: LocaleTextResolver;
};

type UseProofreadingDialogActionsResult = {
  dialog_state: ProofreadingDialogState;
  dialog_item: ProofreadingItem | null;
  reset_dialog: () => void;
  open_edit_dialog: (row_id: string) => Promise<void>;
  update_dialog_draft: (patch: Partial<ProofreadingDialogState["draft_item"]>) => void;
  save_dialog_entry: () => Promise<void>;
};

export function create_empty_dialog_state(): ProofreadingDialogState {
  return {
    open: false,
    target_row_id: null,
    draft_item: {
      dst: "",
      name_dst: "",
    },
    saving: false,
  };
}

// 管理校对编辑弹窗的打开、草稿和保存提交。
export function useProofreadingDialogActions(
  options: UseProofreadingDialogActionsOptions,
): UseProofreadingDialogActionsResult {
  const [dialog_state, set_dialog_state] = useState<ProofreadingDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [dialog_item_snapshot, set_dialog_item_snapshot] = useState<ProofreadingItem | null>(null);

  const dialog_item = useMemo(() => {
    return dialog_state.target_row_id === null
      ? null
      : (options.visible_item_by_id.get(dialog_state.target_row_id) ?? dialog_item_snapshot);
  }, [dialog_item_snapshot, dialog_state.target_row_id, options.visible_item_by_id]);

  const reset_dialog = useCallback((): void => {
    set_dialog_state(create_empty_dialog_state());
    set_dialog_item_snapshot(null);
  }, []);

  const open_edit_dialog = useCallback(
    async (row_id: string): Promise<void> => {
      const target_item = (await options.read_items_by_row_ids([row_id]))[0];
      if (target_item === undefined) {
        return;
      }

      set_dialog_item_snapshot(target_item);
      set_dialog_state({
        open: true,
        target_row_id: row_id,
        draft_item: {
          dst: target_item.dst,
          name_dst: read_item_name_text(target_item.name_dst),
        },
        saving: false,
      });
    },
    [options],
  );

  const update_dialog_draft = useCallback(
    (patch: Partial<ProofreadingDialogState["draft_item"]>): void => {
      set_dialog_state((previous_state) => {
        return {
          ...previous_state,
          draft_item: {
            ...previous_state.draft_item,
            ...patch,
          },
        };
      });
    },
    [],
  );

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    if (dialog_state.target_row_id === null) {
      return;
    }

    const target_item_id = Number(dialog_state.target_row_id);
    const target_item = Number.isInteger(target_item_id)
      ? (await options.read_items_by_row_ids([dialog_state.target_row_id]))[0]
      : undefined;
    if (target_item === undefined) {
      reset_dialog();
      return;
    }

    if (
      dialog_state.draft_item.dst === target_item.dst &&
      dialog_state.draft_item.name_dst === read_item_name_text(target_item.name_dst)
    ) {
      reset_dialog();
      options.push_toast("success", options.t("app.feedback.save_success"));
      return;
    }

    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        saving: true,
      };
    });

    try {
      await options.run_project_write({
        path: "/api/proofreading/item/save",
        plan: create_save_item_plan({
          snapshot: {
            items: [target_item],
            section_revisions: options.list_revisions,
          },
          item_id: Number(target_item.item_id),
          next_dst: dialog_state.draft_item.dst,
          next_name_dst: dialog_state.draft_item.name_dst,
        }),
        fallback_error_key: "proofreading_page.feedback.save_failed",
        preferred_row_id: dialog_state.target_row_id,
        success_message_builder: () => options.t("app.feedback.save_success"),
        close_dialog: true,
      });
    } finally {
      set_dialog_state((previous_state) => {
        if (previous_state.target_row_id !== dialog_state.target_row_id) {
          return previous_state;
        }

        return {
          ...previous_state,
          saving: false,
        };
      });
    }
  }, [dialog_state, options, reset_dialog]);

  return {
    dialog_state,
    dialog_item,
    reset_dialog,
    open_edit_dialog,
    update_dialog_draft,
    save_dialog_entry,
  };
}
