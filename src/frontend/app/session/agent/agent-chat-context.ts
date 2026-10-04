import type { AgentEntry, AgentTokenSpeedSnapshot } from "@shared/agent";
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { AgentDecisionCountdownSnapshot } from "./agent-decision-countdown";
import type {
  AgentChatStore,
  AgentControlsSlice,
  AgentInputState,
  AgentQueueSlice,
  AgentChatActions,
  AgentSkillsSlice,
  AgentTimelineSlice,
} from "./agent-chat-store";

export type { AgentCommand, AgentTransportState } from "./agent-chat-store";
export type { AgentInputState } from "./agent-chat-store";

export const AgentChatStoreContext = createContext<AgentChatStore | null>(null);

/** 对话身份随权威快照变化。页面资源以此隔离生命周期。 */
export function useAgentChatId(): string | null {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_controls, store.get_chat_id, store.get_chat_id);
}

/** 高频测速只通知当前回合状态条的实时数字。 */
export function useAgentTokenSpeed(): AgentTokenSpeedSnapshot {
  const store = use_agent_store();
  return useSyncExternalStore(
    store.subscribe_token_speed,
    store.get_token_speed,
    store.get_token_speed,
  );
}

/** 订阅时间线顺序和操作状态，消息正文通过条目订阅更新。 */
export function useAgentTimeline(): AgentTimelineSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_timeline, store.get_timeline, store.get_timeline);
}

/** 单个条目只在自己的内容变化或被快照移除时更新。 */
export function useAgentEntry(id: string | null): AgentEntry | undefined {
  const { timeline } = use_agent_store();
  const subscribe = useCallback(
    (listener: () => void) => timeline.subscribe_entry(id, listener),
    [timeline, id],
  );
  const read = useCallback(() => timeline.entry(id), [timeline, id]);
  return useSyncExternalStore(subscribe, read, read);
}

/** 轮次只订阅条目顺序，正文更新由各行消费。 */
export function useAgentRound(id: string): {
  entryIds: readonly string[];
  latestAssistantId: string | undefined;
} {
  const { timeline } = use_agent_store();
  const read = useCallback(() => timeline.round(id), [timeline, id]);
  const entryIds = useSyncExternalStore(timeline.subscribe, read, read);
  return { entryIds, latestAssistantId: timeline.latest_assistant(id) };
}

/** 订阅运行状态、正在处理的内容、待决问题与命令占用。 */
export function useAgentControls(): AgentControlsSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_controls, store.get_controls, store.get_controls);
}

/** 订阅后端队列顺序及其可操作状态。 */
export function useAgentQueue(): AgentQueueSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_queue, store.get_queue, store.get_queue);
}

/** 订阅当前可用技能资源。 */
export function useAgentSkills(): AgentSkillsSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_skills, store.get_skills, store.get_skills);
}

/** 读取跨路由保留的草稿与输入历史入口。 */
export function useAgentInput(): AgentInputState {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_input, store.get_input, store.get_input);
}

/** 倒计时只由决策区域订阅，避免每秒刷新整页会话与时间线。 */
export function useAgentDecisionCountdown(): AgentDecisionCountdownSnapshot {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_countdown, store.get_countdown, store.get_countdown);
}

/** actions 在 Store 生命周期内保持同一对象和函数身份，不订阅任何业务切片。 */
export function useAgentChatActions(): AgentChatActions {
  return use_agent_store().actions;
}

/** 限定 Hook 的 Provider 边界，避免创建平行会话。 */
function use_agent_store(): AgentChatStore {
  const store = useContext(AgentChatStoreContext);
  if (store === null) {
    throw new Error("Agent chat hooks must be used inside AgentChatProvider.");
  }
  return store;
}
