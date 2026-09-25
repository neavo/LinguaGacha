import { type JSX, useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { AgentSessionStore } from "./agent-session-store";
import { AgentSessionStoreContext } from "./agent-session-context";

/** 常驻 Store 跨路由拥有 Agent 镜像和输入会话；Provider 只负责生命周期装配。 */
export function AgentSessionProvider(props: { children: ReactNode }): JSX.Element {
  const { t } = useI18n();

  // Store 跨路由常驻，异步失败时读取最新语言。
  const text = useRef(t);
  text.current = t;
  const store_ref = useRef<AgentSessionStore | null>(null);
  if (store_ref.current === null) {
    store_ref.current = new AgentSessionStore(window.localStorage, (error) => {
      const t = text.current;
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
