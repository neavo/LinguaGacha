import type { ProofreadingProjectWriteRunner } from "./proofreading-page-state-contract";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TextResolver } from "@shared/i18n";
import { create_apply_item_changes_plan } from "@shared/proofreading/proofreading-command-planner";
import { read_item_name_text } from "@shared/item-name";
import type {
  ProofreadingClientItem,
  ProofreadingContextItem,
  ProofreadingItem,
} from "@shared/proofreading/proofreading-types";
import type { ProjectDataSectionRevisions } from "@shared/project-event";
import type { ProofreadingDialogState } from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import type { ProjectItemPublicRecord } from "@domain/item";

type UseProofreadingDialogActionsOptions = {
  list_revisions: ProjectDataSectionRevisions; // 弹窗保存使用列表 query 已消费的 revision 锁
  visible_item_by_id: Map<string, ProofreadingClientItem>;
  read_items_by_row_ids: (row_ids: string[]) => Promise<ProofreadingClientItem[]>;
  read_context: (row_id: string) => Promise<ProofreadingContextItem[]>;
  read_raw_item: (row_id: string) => Promise<ProjectItemPublicRecord>;
  run_project_write: ProofreadingProjectWriteRunner;
  t: TextResolver;
};

type UseProofreadingDialogActionsResult = {
  dialog_state: ProofreadingDialogState;
  dialog_item: ProofreadingItem | null;
  reset_dialog: () => void;
  open_edit_dialog: (row_id: string) => Promise<void>;
  show_dialog_item: (item: ProofreadingClientItem) => void;
  update_dialog_draft: (patch: Partial<ProofreadingDialogState["draft_item"]>) => void;
  open_dialog_view: (kind: "context" | "raw-data") => Promise<void>;
  return_to_edit: () => void;
  save_dialog_entry: () => Promise<void>;
  save_dialog_draft: () => Promise<boolean>;
};

/** 创建关闭弹窗时的初始状态。 */
function create_empty_dialog_state(): ProofreadingDialogState {
  return {
    open: false,
    target_row_id: null,
    draft_item: {
      dst: "",
      name_dst: "",
    },
    pending: false,
    view: { kind: "edit" },
  };
}

/** 管理校对条目弹窗的打开、草稿、查看请求和保存提交。 */
export function useProofreadingDialogActions(
  options: UseProofreadingDialogActionsOptions,
): UseProofreadingDialogActionsResult {
  const [dialog_state, set_dialog_state] = useState<ProofreadingDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [dialog_item_snapshot, set_dialog_item_snapshot] = useState<ProofreadingItem | null>(null); // 目标离开列表窗口时仍保留编辑基线。
  const dialog_request_id_ref = useRef(0); // 返回、关闭或重开时，旧的条目与查看响应都不得回写
  const save_pending_ref = useRef(false); // 同一草稿保存只允许一个在途提交

  // 离页撤销详情与保存前读取的身份，迟到结果不能继续写入或通知。
  useEffect(
    () => () => {
      dialog_request_id_ref.current += 1;
    },
    [],
  );

  // 列表与详情携带同一组事实，可见行更新时直接使用窗口快照。
  const dialog_item =
    dialog_state.target_row_id === null
      ? null
      : (options.visible_item_by_id.get(dialog_state.target_row_id) ?? dialog_item_snapshot);

  /** 关闭弹窗并使旧详情请求失效。 */
  const reset_dialog = useCallback((): void => {
    dialog_request_id_ref.current += 1;
    set_dialog_state(create_empty_dialog_state());
    set_dialog_item_snapshot(null);
  }, []);

  /** 已读取的详情与草稿一起提交，供普通打开和上下文导航复用。 */
  const show_dialog_item = useCallback((item: ProofreadingClientItem): void => {
    dialog_request_id_ref.current += 1;
    set_dialog_item_snapshot(item);
    set_dialog_state({
      open: true,
      target_row_id: item.row_id,
      draft_item: { dst: item.dst, name_dst: read_item_name_text(item.name_dst) },
      pending: false,
      view: { kind: "edit" },
    });
  }, []);

  /** 按目标身份准备可编辑草稿。 */
  const open_edit_dialog = useCallback(
    async (row_id: string): Promise<void> => {
      const request_id = ++dialog_request_id_ref.current;
      let target_item: ProofreadingClientItem | undefined;
      try {
        target_item = (await options.read_items_by_row_ids([row_id]))[0];
      } catch (error) {
        if (dialog_request_id_ref.current === request_id) {
          push_error_toast(options.t("app.feedback.refresh_failed"), error);
        }
        return;
      }
      if (target_item === undefined || dialog_request_id_ref.current !== request_id) {
        return;
      }

      show_dialog_item(target_item);
    },
    [options, show_dialog_item],
  );

  /** 更新本地草稿并保留弹窗操作上下文。 */
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

  /** 返回编辑并使在途查看请求失效，草稿由弹窗继续持有。 */
  const return_to_edit = useCallback((): void => {
    dialog_request_id_ref.current += 1;
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        view: { kind: "edit" },
      };
    });
  }, []);

  /** 每次进入查看视图读取当前数据，过期响应由请求身份隔离。 */
  const open_dialog_view = useCallback(
    async (kind: "context" | "raw-data"): Promise<void> => {
      const target_row_id = dialog_state.target_row_id;
      if (target_row_id === null || dialog_state.pending) {
        return;
      }
      const request_id = ++dialog_request_id_ref.current;

      set_dialog_state((previous_state) => {
        return {
          ...previous_state,
          view: { kind, status: "loading" },
        };
      });

      let view: ProofreadingDialogState["view"];
      try {
        if (kind === "context") {
          const items = await options.read_context(target_row_id);
          if (!items.some((item) => item.row_id === target_row_id)) {
            throw new Error("The requested entry is absent from the context response.");
          }
          view = { kind, status: "ready", items };
        } else {
          const item = await options.read_raw_item(target_row_id);
          view = { kind, status: "ready", text: JSON.stringify(item, null, 2) };
        }
      } catch (error) {
        if (dialog_request_id_ref.current !== request_id) return;
        push_error_toast(options.t("app.feedback.read_failed"), error);
        view = { kind, status: "error" };
      }
      set_dialog_state((previous_state) => {
        if (dialog_request_id_ref.current !== request_id) {
          return previous_state;
        }
        return {
          ...previous_state,
          view,
        };
      });
    },
    [dialog_state.pending, dialog_state.target_row_id, options],
  );

  /** 保存实际内容差异，显式保存与导航共用读取、互斥和提交过程。 */
  const save_dialog_draft = useCallback(async (): Promise<boolean> => {
    const row_id = dialog_state.target_row_id;
    if (row_id === null || save_pending_ref.current) return false;
    const request_id = ++dialog_request_id_ref.current;
    save_pending_ref.current = true;
    set_dialog_state((previous) => ({ ...previous, pending: true }));
    try {
      const target_item = (await options.read_items_by_row_ids([row_id]))[0];
      if (dialog_request_id_ref.current !== request_id) return false;
      if (target_item === undefined) throw new Error("The requested entry is absent.");
      // 只提交实际编辑，正文与姓名共用条目完成规则。
      const { dst, name_dst } = dialog_state.draft_item;
      const plan = create_apply_item_changes_plan({
        snapshot: { items: [target_item], section_revisions: options.list_revisions },
        changes: [
          {
            item_id: Number(target_item.item_id),
            ...(dst !== target_item.dst ? { dst } : {}),
            ...(name_dst !== read_item_name_text(target_item.name_dst) ? { name_dst } : {}),
          },
        ],
      });
      if (plan === null) return true;
      const result = await options.run_project_write({
        path: "/api/proofreading/items/update",
        plan,
        fallback_error_key: "app.feedback.save_failed",
        preferred_row_id: row_id,
      });
      return result && dialog_request_id_ref.current === request_id;
    } catch (error) {
      if (dialog_request_id_ref.current === request_id)
        push_error_toast(options.t("app.feedback.save_failed"), error);
      return false;
    } finally {
      save_pending_ref.current = false;
      if (dialog_request_id_ref.current === request_id)
        set_dialog_state((previous) => ({ ...previous, pending: false }));
    }
  }, [dialog_state, options]);

  /** 显式保存成功后结束当前编辑，无内容差异时不提交。 */
  const save_dialog_entry = useCallback(async (): Promise<void> => {
    if (await save_dialog_draft()) reset_dialog();
  }, [save_dialog_draft, reset_dialog]);

  return {
    dialog_state,
    dialog_item,
    reset_dialog,
    open_edit_dialog,
    show_dialog_item,
    update_dialog_draft,
    open_dialog_view,
    return_to_edit,
    save_dialog_entry,
    save_dialog_draft,
  };
}
