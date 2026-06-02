export type ProofreadingDialogState = {
  open: boolean;
  target_row_id: string | null;
  draft_item: {
    dst: string;
    name_dst: string;
  };
  saving: boolean;
};

export type ProofreadingConfirmationKind = "retranslate" | "clear-translations";

export type ProofreadingPendingConfirmation = {
  kind: ProofreadingConfirmationKind; // 只有高风险操作进入确认流，状态设置走直接提交。
  target_row_ids: string[];
  preferred_row_id: string | null;
  submitting: boolean;
};
