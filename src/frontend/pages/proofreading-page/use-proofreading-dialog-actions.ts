import { useCallback, useMemo, useRef, useState } from "react";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  create_update_items_plan,
  type ProofreadingCommandPlan,
} from "@shared/proofreading/proofreading-command-planner";
import { read_item_name_text } from "@shared/item-name";
import type {
  ProofreadingClientItem,
  ProofreadingContextItem,
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
  read_context: (row_id: string) => Promise<ProofreadingContextItem[]>;
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
  open_dialog_context: () => Promise<void>;
  close_dialog_context: () => void;
  save_dialog_entry: () => Promise<void>;
};

/** 创建未打开且没有异步上下文残留的弹窗状态。 */
export function create_empty_dialog_state(): ProofreadingDialogState {
  return {
    open: false,
    target_row_id: null,
    draft_item: {
      dst: "",
      name_dst: "",
    },
    saving: false,
    context: {
      status: "idle",
    },
  };
}

/** 管理校对编辑弹窗的打开、草稿、上下文读取和保存提交。 */
export function useProofreadingDialogActions(
  options: UseProofreadingDialogActionsOptions,
): UseProofreadingDialogActionsResult {
  const [dialog_state, set_dialog_state] = useState<ProofreadingDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [dialog_item_snapshot, set_dialog_item_snapshot] = useState<ProofreadingItem | null>(null);
  const dialog_request_id_ref = useRef(0); // 弹窗关闭或重开时，旧的条目与上下文响应都不得回写

  const dialog_item = useMemo(() => {
    if (dialog_state.target_row_id === null) {
      return null;
    }
    const visible_item = options.visible_item_by_id.get(dialog_state.target_row_id);
    if (visible_item === undefined || dialog_item_snapshot === null) {
      return visible_item ?? dialog_item_snapshot;
    }
    // 详情快照提供按需字段，列表窗口只覆盖它实际携带的最新行事实。
    return { ...dialog_item_snapshot, ...visible_item };
  }, [dialog_item_snapshot, dialog_state.target_row_id, options.visible_item_by_id]);

  const reset_dialog = useCallback((): void => {
    dialog_request_id_ref.current += 1;
    set_dialog_state(create_empty_dialog_state());
    set_dialog_item_snapshot(null);
  }, []);

  const open_edit_dialog = useCallback(
    async (row_id: string): Promise<void> => {
      const request_id = dialog_request_id_ref.current + 1;
      dialog_request_id_ref.current = request_id;
      const target_item = (await options.read_items_by_row_ids([row_id]))[0];
      if (target_item === undefined || dialog_request_id_ref.current !== request_id) {
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
        context: {
          status: "idle",
        },
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

  const close_dialog_context = useCallback((): void => {
    dialog_request_id_ref.current += 1;
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        context: {
          status: "idle",
        },
      };
    });
  }, []);

  const open_dialog_context = useCallback(async (): Promise<void> => {
    const target_row_id = dialog_state.target_row_id;
    if (target_row_id === null || dialog_state.saving) {
      return;
    }
    const request_id = dialog_request_id_ref.current + 1;
    dialog_request_id_ref.current = request_id;

    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        context: {
          status: "loading",
        },
      };
    });

    // 请求失败与空响应统一进入可重试错误态，不需要保留供应商异常。
    const items = await options.read_context(target_row_id).catch(() => []);
    const has_target = items.some((item) => item.row_id === target_row_id);
    set_dialog_state((previous_state) => {
      if (
        dialog_request_id_ref.current !== request_id ||
        previous_state.target_row_id !== target_row_id ||
        previous_state.context.status !== "loading"
      ) {
        return previous_state;
      }
      return {
        ...previous_state,
        context: has_target ? { status: "ready", items } : { status: "error" },
      };
    });
  }, [dialog_state.saving, dialog_state.target_row_id, options]);

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
        path: "/api/proofreading/items/update",
        plan: create_update_items_plan({
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
    open_dialog_context,
    close_dialog_context,
    save_dialog_entry,
  };
}
