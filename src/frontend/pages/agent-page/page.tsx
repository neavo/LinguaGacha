import { useEffect, useLayoutEffect, useMemo, useRef, type JSX } from "react";
import { FileText, MessageSquareText, X } from "lucide-react";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import {
  useAgentControls,
  useAgentSessionId,
} from "@frontend/app/session/agent/agent-session-context";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@frontend/shadcn/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AgentConversation } from "./agent-conversation";
import { AgentDocumentPage } from "./agent-document";
import { AgentDocumentContext } from "./agent-document-context";
import { useAgentDocuments } from "./use-agent-documents";
import "./agent-documents.css";

const CONVERSATION_TAB = "conversation";

/** 对话身份决定全部页内资源的生命周期。 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const session_id = useAgentSessionId();
  return <AgentPages key={session_id ?? "restoring"} session_id={session_id ?? ""} />;
}

/** 页内标签保留组件实例，会话身份变化才整体释放旧页面。 */
function AgentPages({ session_id }: { session_id: string }): JSX.Element {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const { pendingDecision } = useAgentControls();
  const { agent_input_request } = useAppNavigation();
  const state = useAgentDocuments(session_id);
  const { select } = state;
  const conversation_active = state.selected === null;
  const context = useMemo(
    () => ({ open_document: state.open_document, session_id, active: true }),
    [state.open_document, session_id],
  );
  const inactive_context = useMemo(() => ({ ...context, active: false }), [context]);
  useEffect(() => {
    if (agent_input_request) select(null);
  }, [agent_input_request, select]);
  /** 关闭后从已提交的 DOM 恢复焦点，最后一个标签关闭时回到对话面板。 */
  const focus_current = (): void => {
    const target = !root.current?.querySelector<HTMLElement>('[role="tablist"]')?.hidden
      ? root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      : root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
    target?.focus({ preventScroll: true });
  };
  const previous_selected = useRef(state.selected);
  useLayoutEffect(() => {
    if (previous_selected.current === state.selected) return;
    previous_selected.current = state.selected;
    const target = root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (state.documents.length > 0) target?.focus({ preventScroll: true });
  }, [state.selected, state.documents.length]);
  return (
    <Tabs
      ref={root}
      className="agent-pages"
      value={state.selected ?? CONVERSATION_TAB}
      onValueChange={(value) => select(value === CONVERSATION_TAB ? null : String(value))}
    >
      <TabsList
        className="agent-pages__tabs"
        hidden={state.documents.length === 0}
        activateOnFocus={false}
      >
        <TabsTrigger className="agent-pages__tab" value={CONVERSATION_TAB}>
          <MessageSquareText aria-hidden="true" />
          <span className="agent-pages__filename">
            {t("agent_page.document.conversation")}
            {pendingDecision ? (
              <span className="agent-pages__attention">
                {t("agent_page.document.needs_response")}
              </span>
            ) : null}
          </span>
        </TabsTrigger>
        {state.documents.map((document) => (
          <span className="agent-pages__tab-group" key={document.path}>
            <Tooltip>
              <TooltipTrigger
                render={<TabsTrigger className="agent-pages__tab" value={document.path} />}
              >
                <FileText aria-hidden="true" />
                <span className="agent-pages__filename">
                  {decodeURIComponent(document.path.split("/").at(-1)!)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{decodeURIComponent(document.path)}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="agent-pages__close"
                    aria-label={t("app.action.close")}
                    onClick={() => {
                      state.close(document.path);
                      requestAnimationFrame(focus_current);
                    }}
                  />
                }
              >
                <X aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("app.action.close")}</TooltipContent>
            </Tooltip>
          </span>
        ))}
      </TabsList>
      <TabsContent className="agent-pages__panel" value={CONVERSATION_TAB} keepMounted>
        <AgentDocumentContext value={conversation_active ? context : inactive_context}>
          <AgentConversation active={conversation_active} />
        </AgentDocumentContext>
      </TabsContent>
      {state.documents.map((document) => (
        <TabsContent
          className="agent-pages__panel"
          key={document.path}
          value={document.path}
          keepMounted
        >
          <AgentDocumentContext
            value={state.selected === document.path ? context : inactive_context}
          >
            <AgentDocumentPage
              document={document}
              active={state.selected === document.path}
              scroll={state.scroll.current}
            />
          </AgentDocumentContext>
        </TabsContent>
      ))}
    </Tabs>
  );
}
