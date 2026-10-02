import { defineDoc, type EntryId } from "@earendil-works/pi-durable";
import type {
  AgentEntry,
  AgentEntryStatus,
  AgentMessageInput,
  AgentPendingDecision,
} from "../../shared/agent";
import type { AgentInputQueueState } from "./agent-input-queue";

export type AgentInputRecord = {
  roundId: string;
  message: AgentMessageInput;
  delivery: "round" | "steer" | "hidden";
  queuedId: string | null;
};
export type AgentRoundRecord = {
  status: AgentEntryStatus;
  checkpoint: EntryId;
  endedAt: number | null;
  averageTokensPerSecond: number | null;
};

/** 产品事实跨分叉保留；条目关联按不可变身份筛选，避免复制队列、恢复旧审批。 */
export type AgentSessionState = {
  queue: AgentInputQueueState;
  doing: string | null;
  pendingDecision: AgentPendingDecision | null;
  inputs: Record<string, AgentInputRecord>;
  rounds: Record<string, AgentRoundRecord>;
  stoppedEntries: Record<string, { roundId: string; entry: AgentEntry }>;
};

export const AgentSessionDoc = defineDoc<AgentSessionState>({
  kind: "linguagacha.session",
  version: 1,
  scope: "session",
  initial: () => ({
    queue: { items: [], paused: false },
    doing: null,
    pendingDecision: null,
    inputs: {},
    rounds: {},
    stoppedEntries: {},
  }),
});
