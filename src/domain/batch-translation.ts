import type { ItemStatus } from "./item";

export type BatchTranslationOperation = "translate" | "retranslate";

export type BatchTranslationScope = { kind: "all" } | { kind: "items"; item_ids: number[] };

export type AgentBatchTranslationRequest = Readonly<{
  item_ids?: readonly number[];
  item_statuses?: readonly ItemStatus[];
}>;

export type BatchTranslationStartCommand =
  | { operation: "translate"; scope: BatchTranslationScope }
  | { operation: "retranslate"; scope: Extract<BatchTranslationScope, { kind: "items" }> };
