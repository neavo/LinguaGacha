import { defineDocFamily, type EntryId, type ConversationId } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEntry, AgentEntryStatus, AgentMessageInput } from "../../shared/agent";
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

/** 产品事实跨分叉保留，输入关联按不可变身份筛选。 */
export type AgentSessionState = {
  activeConversationId: ConversationId | null; // 与 SDK 分叉在同一事务中更新
  seeded: boolean; // 首次配置模型时写入种子，重开沿用已有历史
  taskCreatedAt: Record<string, number>; // SDK 任务没有绝对时间，保留公开压缩条目的时间
  queue: AgentInputQueueState;
  doing: string | null;
  inputs: Record<string, AgentInputRecord>;
  rounds: Record<string, AgentRoundRecord>;
  stoppedEntries: Record<
    string,
    {
      roundId: string;
      entry: AgentEntry;
      source?: Pick<AssistantMessage, "api" | "provider" | "model">; // 节流窗口内的正文可能没有 SDK 条目，离线修订仍需原始模型身份
    }
  >;
};

export const AgentSessionDoc = defineDocFamily<AgentSessionState, null>({
  kind: "linguagacha.session",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({
    activeConversationId: null,
    seeded: false,
    taskCreatedAt: {},
    queue: { items: [], paused: false },
    doing: null,
    inputs: {},
    rounds: {},
    stoppedEntries: {},
  }),
});
