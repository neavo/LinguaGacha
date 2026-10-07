import { defineDocFamily, type EntryId, type ConversationId } from "@earendil-works/pi-durable";
import type { JsonRecord } from "../../domain/json";
import type { AgentInputCommandKind, AgentInputCommandStatus } from "../../shared/agent";
import type { AgentEntryStatus, AgentMessageInput } from "../../shared/agent";
import type { AgentInputQueueState } from "./agent-input-queue";
import { AppError } from "../../shared/error";

/** 产品输入关联 SDK 提交，隐藏继续输入仍属于原轮次。 */
export type AgentInputRecord = {
  roundId: string;
  message: AgentMessageInput;
  delivery: "round" | "steer" | "hidden";
  queuedId: string | null;
};
/** 一轮用户意图可跨多次 SDK 生成，统一保存终态与修订切点。 */
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
  compactionStartedAt: Record<string, number>; // SDK 任务创建包含切点选择，产品仅在确认摘要范围后保存公开起点。
};

/** 产品事实按 `chatId` 保存，SDK 历史分叉共享队列和命令受理记录。 */
export const AgentChatDoc = defineDocFamily<AgentChatData, null>({
  kind: "linguagacha.chat",
  version: 2,
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
    compactionStartedAt: {},
  }),
  migrate: (value, fromVersion) => {
    if (fromVersion !== 1) throw new AppError("file.invalid_structure");
    // 旧任务没有起始时间事实，迁移只建立空索引。
    return { ...value, compactionStartedAt: {} } as AgentChatData;
  },
});
