import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

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
  const store_ref = useRef<AgentSessionStore | null>(null);
  if (store_ref.current === null) store_ref.current = new AgentSessionStore(window.localStorage);
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

export function useAgentTimeline(): AgentTimelineSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_timeline, store.get_timeline, store.get_timeline);
}

export function useAgentControls(): AgentControlsSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_controls, store.get_controls, store.get_controls);
}

export function useAgentQueue(): AgentQueueSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_queue, store.get_queue, store.get_queue);
}

export function useAgentTodo(): AgentTodoSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_todo, store.get_todo, store.get_todo);
}

export function useAgentSkills(): AgentSkillsSlice {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_skills, store.get_skills, store.get_skills);
}

export function useAgentInput(): AgentInputSession {
  const store = use_agent_store();
  return useSyncExternalStore(store.subscribe_input, store.get_input, store.get_input);
}

/** actions 在 Store 生命周期内保持同一对象和函数身份，不订阅任何业务切片。 */
export function useAgentSessionActions(): AgentSessionActions {
  return use_agent_store().actions;
}

function use_agent_store(): AgentSessionStore {
  const store = useContext(AgentSessionStoreContext);
  if (store === null) {
    throw new Error("Agent session hooks must be used inside AgentSessionProvider.");
  }
  return store;
}
