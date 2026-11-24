import { createPortal } from "react-dom";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import { FileText, Image, MessageSquareText, X } from "lucide-react";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import {
  useAgentCanReset,
  useAgentChatActions,
  useAgentChatId,
  useAgentControls,
} from "@frontend/app/session/agent/agent-chat-context";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { is_project_busy } from "@frontend/app/state/runtime-activity-store";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@frontend/shadcn/tabs";
import { Tooltip, TooltipContent, TooltipTarget, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { AgentConversation } from "./agent-conversation";
import { AgentPreviewPage } from "./agent-preview";
import { AgentFileContext } from "./agent-file-context";
import { useAgentPreviews } from "./use-agent-previews";
import "@frontend/widgets/inline-action-button.css";
import "./agent-documents.css";

const CONVERSATION_TAB = "conversation";

/** 对话身份决定全部页内资源的生命周期。 */
export function AgentPage({
  tabHost,
  active = true,
}: { tabHost?: HTMLElement | null; active?: boolean } = {}): JSX.Element {
  const chat_id = useAgentChatId();
  const [reset_open, set_reset_open] = useState(false);
  return (
    <>
      <AgentPages
        key={chat_id ?? "restoring"}
        chat_id={chat_id ?? ""}
        tabHost={tabHost ?? null}
        active={active}
        on_request_reset={() => set_reset_open(true)}
      />
      {reset_open && <ConversationResetDialog on_close={() => set_reset_open(false)} />}
    </>
  );
}

/** 页内标签保留组件实例，会话身份变化才整体释放旧页面。 */
function AgentPages({
  chat_id,
  tabHost,
  active,
  on_request_reset,
}: {
  chat_id: string;
  tabHost: HTMLElement | null;
  active: boolean;
  on_request_reset: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const { pendingDecision } = useAgentControls();
  const { agent_input_request, navigate_to_route } = useAppNavigation();
  const state = useAgentPreviews(chat_id);
  const { select } = state;
  const conversation_active = active && state.selected === null;
  const context = useMemo(
    () => ({ open_file: state.open_file, chat_id, active }),
    [state.open_file, chat_id, active],
  );
  const inactive_context = useMemo(() => ({ ...context, active: false }), [context]);
  useEffect(() => {
    if (agent_input_request) select(null);
  }, [agent_input_request, select]);
  /** 关闭后从已提交的 DOM 恢复焦点，最后一个标签关闭时回到对话面板。 */
  const find_selected_tab = () =>
    (tabHost ?? root.current)?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  const focus_current = (): void => {
    const target =
      find_selected_tab() ??
      root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
    target?.focus({ preventScroll: true });
  };
  const previous_selected = useRef(state.selected);
  useLayoutEffect(() => {
    if (previous_selected.current === state.selected) return;
    previous_selected.current = state.selected;
    const target = (tabHost ?? root.current)?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (state.documents.length > 0) target?.focus({ preventScroll: true });
  }, [state.selected, state.documents.length, tabHost]);
  const tabs = (
    <TabsList
      className="agent-pages__tabs"
      hidden={tabHost === null && state.documents.length === 0}
      activateOnFocus={false}
    >
      <span className="agent-pages__tab-group">
        <TabsTrigger
          className="agent-pages__tab"
          value={CONVERSATION_TAB}
          onClick={tabHost === null ? undefined : () => navigate_to_route("agent")}
          data-needs-response={pendingDecision && !conversation_active ? "" : undefined}
        >
          <MessageSquareText aria-hidden="true" />
          <span className="agent-pages__filename">{t("agent_page.document.conversation")}</span>
        </TabsTrigger>
        <ConversationResetButton on_click={on_request_reset} />
      </span>
      {state.documents.map((document) => (
        <span className="agent-pages__tab-group" key={document.path}>
          <Tooltip>
            <TooltipTrigger
              render={
                <TabsTrigger
                  className="agent-pages__tab"
                  value={document.path}
                  onClick={tabHost === null ? undefined : () => navigate_to_route("agent")}
                />
              }
            >
              {document.preview === "image" ? (
                <Image aria-hidden="true" />
              ) : (
                <FileText aria-hidden="true" />
              )}
              <span className="agent-pages__filename">{document.name}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{decodeURIComponent(document.path)}</TooltipContent>
          </Tooltip>
          <button
            type="button"
            className="inline-action-button agent-pages__close"
            aria-label={t("app.action.close")}
            onClick={() => {
              state.close(document.path);
              requestAnimationFrame(focus_current);
            }}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      ))}
    </TabsList>
  );
  return (
    <Tabs
      ref={root}
      className="agent-pages"
      value={state.selected ?? CONVERSATION_TAB}
      onValueChange={(value) => select(value === CONVERSATION_TAB ? null : String(value))}
    >
      {tabHost === null ? tabs : createPortal(tabs, tabHost)}
      <TabsContent className="agent-pages__panel" value={CONVERSATION_TAB} keepMounted>
        <AgentFileContext value={conversation_active ? context : inactive_context}>
          <AgentConversation active={conversation_active} />
        </AgentFileContext>
      </TabsContent>
      {state.documents.map((document) => (
        <TabsContent
          className="agent-pages__panel"
          key={document.path}
          value={document.path}
          keepMounted
        >
          <AgentFileContext value={state.selected === document.path ? context : inactive_context}>
            <AgentPreviewPage
              document={document}
              active={active && state.selected === document.path}
              scroll={state.scroll.current}
            />
          </AgentFileContext>
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** 汇总当前工程会话的重置可用性与繁忙态，避免按钮和确认弹窗各自维护判断。 */
function use_conversation_reset_state(): { busy: boolean; disabled: boolean } {
  const can_reset = useAgentCanReset();
  const scope = useContext(ProjectScopeContext);
  const { projects } = useRuntimeSnapshot();
  const lifecycle = useProjectLifecycle();
  const busy = scope !== null && is_project_busy(projects?.[scope.projectId]);
  return { busy, disabled: busy || lifecycle.busy || !can_reset };
}

/** 独立订阅重置可用性，避免草稿和任务状态变化刷新整个对话标签栏。 */
function ConversationResetButton({ on_click }: { on_click: () => void }): JSX.Element {
  const { t } = useI18n();
  const { busy, disabled } = use_conversation_reset_state();
  const close_label = t("app.workspace.close_chat");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TooltipTarget className="agent-pages__tab-action">
            <button
              type="button"
              className="inline-action-button"
              aria-label={close_label}
              disabled={disabled}
              onClick={on_click}
            >
              <X aria-hidden="true" />
            </button>
          </TooltipTarget>
        }
      />
      <TooltipContent side="bottom">
        {busy ? t("app.workspace.close_busy") : close_label}
      </TooltipContent>
    </Tooltip>
  );
}

/** 挂在 AgentPages 外层，避免重置拿到新 chat_id 重建页面时打断提交收尾。 */
function ConversationResetDialog({ on_close }: { on_close: () => void }): JSX.Element {
  const { t } = useI18n();
  const { reset } = useAgentChatActions();
  const { disabled } = use_conversation_reset_state();
  const [submitting, set_submitting] = useState(false);

  async function confirm(): Promise<void> {
    if (disabled || submitting) return;
    set_submitting(true);
    try {
      await reset();
      on_close();
    } catch (error) {
      push_error_toast(t("app.feedback.update_failed"), error);
    } finally {
      set_submitting(false);
    }
  }

  return (
    <AppConfirmDialog
      open
      submitting={submitting}
      confirmDisabled={disabled}
      description={t("app.workspace.close_chat_confirm")}
      onConfirm={confirm}
      onClose={on_close}
    />
  );
}
