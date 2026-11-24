import { ChatTransportContext } from "@frontend/app/desktop/scoped-api";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { AgentAttention } from "@frontend/app/feedback/agent-attention";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { AgentChatStore } from "./agent-chat-store";
import { AgentChatStoreContext, AgentChatRegistryContext } from "./agent-chat-context";
import { AgentChatStoreRegistry } from "./agent-chat-store-registry";

/** 全部打开对话的事件镜像和草稿与页面挂载独立。 */
export function AgentChatRegistryProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const text = useRef(t);
  text.current = t;
  const { open_projects } = useDesktopState();
  const [registry] = useState(
    () =>
      new AgentChatStoreRegistry((error, kind) =>
        push_error_toast(
          text.current(
            kind === "restore" ? "agent_page.error.restore" : "agent_page.error.decision",
          ),
          error,
        ),
      ),
  );
  const scopes = open_projects.flatMap((project) =>
    project.chats.map(({ id }) => ({
      projectId: project.snapshot.projectId,
      chatId: id,
    })),
  );
  const stores = scopes.map((scope) => registry.get(scope));
  useEffect(() => () => registry.disconnect(), [registry]);
  useEffect(() => {
    registry.retain(stores);
  }, [registry, stores]);
  return (
    <AgentChatRegistryContext value={registry}>
      {stores.map((store) => (
        <AgentChatStoreContext
          key={`${store.scope!.projectId}:${store.scope!.chatId}`}
          value={store}
        >
          <AgentAttention />
        </AgentChatStoreContext>
      ))}
      {children}
    </AgentChatRegistryContext>
  );
}

export function AgentChatProvider({
  children,
  store,
}: {
  children: ReactNode;
  store: AgentChatStore;
}): JSX.Element {
  return (
    <AgentChatStoreContext value={store}>
      <ChatTransportContext value={store}>{children}</ChatTransportContext>
    </AgentChatStoreContext>
  );
}
