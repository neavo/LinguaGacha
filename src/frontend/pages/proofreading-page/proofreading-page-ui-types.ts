import type { ProofreadingContextItem } from "@shared/proofreading/proofreading-types";

// idle 同时表示编辑视图；只有 ready 携带数据，避免无数据状态混入过期条目。
export type ProofreadingDialogContextState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: ProofreadingContextItem[] };

export type ProofreadingDialogState = {
  open: boolean;
  target_row_id: string | null;
  draft_item: {
    dst: string;
    name_dst: string;
  };
  saving: boolean;
  context: ProofreadingDialogContextState; // 与编辑草稿同属当前弹窗，关闭弹窗时一并清空
};

export type ProofreadingConfirmationKind = "retranslate" | "clear-translations";

export type ProofreadingConfirmationAction =
  | ProofreadingConfirmationKind
  | "clear-translations-and-reset-status";

export type ProofreadingPendingConfirmation = {
  kind: ProofreadingConfirmationKind; // 只有高风险操作进入确认流，状态设置走直接提交。
  target_row_ids: string[];
  preferred_row_id: string | null;
  submitting_action: ProofreadingConfirmationAction | null;
};
