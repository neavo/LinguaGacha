import type { ProofreadingContextItem } from "@shared/proofreading/proofreading-types";

// 查看状态属于当前弹窗请求，`ready` 数据保留至返回或重新进入。
export type ProofreadingDialogView =
  | { kind: "edit" }
  | { kind: "context"; status: "loading" | "error" }
  | { kind: "context"; status: "ready"; items: ProofreadingContextItem[] }
  | { kind: "raw-data"; status: "loading" | "error" }
  | { kind: "raw-data"; status: "ready"; text: string };

export type ProofreadingDialogState = {
  open: boolean;
  target_row_id: string | null;
  draft_item: {
    dst: string;
    name_dst: string;
  };
  pending: boolean; // 保存或上下文跳转期间阻止重复操作和关闭
  view: ProofreadingDialogView;
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
