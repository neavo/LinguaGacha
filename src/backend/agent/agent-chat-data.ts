import { defineDocFamily, type EntryId, type ConversationId } from "@earendil-works/pi-durable";
import type { JsonRecord } from "../../domain/json";
import type { AgentInputCommandKind, AgentInputCommandStatus } from "../../shared/agent";
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

/** 产品命令记录受理事实，SDK submission 持有执行终态。 */
export type AgentInputCommandRecord = {
  kind: AgentInputCommandKind;
  request: JsonRecord;
  status: AgentInputCommandStatus;
  conversationId: ConversationId | null; // 保存 SDK 提交归属，重开时据此核对回执
  requestId: string | null; // 实际发送时生成，与可编辑队列的入队命令分离
};

/** 产品事实跨分叉保留，输入关联按不可变身份筛选。 */
export type AgentChatData = {
  activeConversationId: ConversationId | null; // 与 SDK 分叉在同一事务中更新
  commands: Record<string, AgentInputCommandRecord>; // 命令回包丢失后仍可查询受理事实
  seeded: boolean; // 首次配置模型时写入种子，重开沿用已有历史
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

export const AgentChatDoc = defineDocFamily<AgentChatData, null>({
  kind: "linguagacha.chat",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({
    activeConversationId: null,
    commands: {},
    seeded: false,
    queue: { items: [], paused: false },
    doing: null,
    inputs: {},
    rounds: {},
    stoppedEntries: {},
  }),
});
