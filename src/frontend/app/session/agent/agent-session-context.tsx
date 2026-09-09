import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import type { AgentDecisionCountdownSnapshot } from "./agent-decision-countdown";

import {
  AgentSessionStore,
  type AgentControlsSlice,
  type AgentInputSession,
  type AgentTodoSlice,
  type AgentQueueSlice,
  type AgentSessionActions,
  type AgentSkillsSlice,
  type AgentTimelineSlice,
} from "./agent-session-store";

export type { AgentCommand, AgentTransportState } from "./agent-session-store";
export type { AgentInputSession } from "./agent-session-store";

const AgentSessionStoreContext = createContext<AgentSessionStore | null>(null);

/** 常驻 Store 跨路由拥有 Agent 镜像和输入会话；Provider 只负责生命周期装配。 */
export function AgentSessionProvider(props: { children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  // Store 跨路由常驻，异步失败使用当前语言与通知入口。
  const feedback = useRef({ t, push_toast });
  feedback.current = { t, push_toast };
  const store_ref = useRef<AgentSessionStore | null>(null);
  if (store_ref.current === null) {
    store_ref.current = new AgentSessionStore(window.localStorage, (error) => {
      const { t, push_toast } = feedback.current;
      push_toast("error", resolve_visible_error_message(error, t, t("agent_page.error.decision")));
    });
  }
  const store = store_ref.current;

  useEffect(() => {
    store.connect();
    return () => store.disconnect();
  }, [store]);

  return (
    <AgentSessionStoreContext.Provider value={store}>
      {props.children}
    </AgentSessionStoreContext.Provider>
  );
}

/** 只订阅时间线，控制与计时更新不触发消息区重绘。 */
export function useAgentTimeline(): AgentTimelineSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_timeline, store.get_timeline, store.get_timeline);
}

/** 订阅运行状态、待决问题与命令占用。 */
export function useAgentControls(): AgentControlsSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_controls, store.get_controls, store.get_controls);
}

/** 订阅后端队列顺序及其可操作状态。 */
export function useAgentQueue(): AgentQueueSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_queue, store.get_queue, store.get_queue);
}

/** 订阅当前会话的任务步骤。 */
export function useAgentTodo(): AgentTodoSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_todo, store.get_todo, store.get_todo);
}

/** 订阅当前可用技能资源。 */
export function useAgentSkills(): AgentSkillsSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_skills, store.get_skills, store.get_skills);
}

/** 读取跨路由保留的草稿与输入历史入口。 */
export function useAgentInput(): AgentInputSession {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_input, store.get_input, store.get_input);
}

/** 倒计时只由决策区域订阅，避免每秒刷新整页会话与时间线。 */
export function useAgentDecisionCountdown(): AgentDecisionCountdownSnapshot {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_countdown, store.get_countdown, store.get_countdown);
}

/** actions 在 Store 生命周期内保持同一对象和函数身份，不订阅任何业务切片。 */
export function useAgentSessionActions(): AgentSessionActions {
  return use_agent_store().actions;
}

/** 限定 Hook 的 Provider 边界，避免创建平行会话。 */
function use_agent_store(): AgentSessionStore {
  const store = useContext(AgentSessionStoreContext);
  if (store === null) {
    throw new Error("Agent session hooks must be used inside AgentSessionProvider.");
  }
  return store;
}
