import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { type JSX, useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AgentChatStore } from "./agent-chat-store";
import { AgentChatStoreContext } from "./agent-chat-context";

/** 常驻 Store 跨路由拥有 Agent 镜像和输入会话；Provider 只负责生命周期装配。 */
export function AgentChatProvider(props: { children: ReactNode }): JSX.Element {
  const { t } = useI18n();

  // Store 跨路由常驻，异步失败时读取最新语言。
  const text = useRef(t);
  text.current = t;
  const store_ref = useRef<AgentChatStore | null>(null);
  if (store_ref.current === null) {
    store_ref.current = new AgentChatStore(window.localStorage, (error, context) => {
      const t = text.current;
      push_error_toast(
        t(context === "restore" ? "agent_page.error.restore" : "agent_page.error.decision"),
        error,
      );
    });
  }
  const store = store_ref.current;

  useEffect(() => {
    store.connect();
    return () => store.disconnect();
  }, [store]);

  return (
    <AgentChatStoreContext.Provider value={store}>{props.children}</AgentChatStoreContext.Provider>
  );
}
