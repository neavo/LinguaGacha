import { useState, useSyncExternalStore, type JSX, type ReactNode } from "react";
import { BookOpenCheck, Files, ShieldCheck, X, ChevronDown, type LucideIcon } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import type { RouteId } from "@frontend/app/navigation/types";
import { SCREEN_REGISTRY } from "@frontend/app/navigation/screen-registry";
import { AgentChatProvider } from "@frontend/app/session/agent/agent-chat-provider";
import { useAgentChatRegistry } from "@frontend/app/session/agent/agent-chat-context";
import { AgentPage } from "@frontend/pages/agent-page/page";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import "./project-workspace.css";

const QUALITY_TABS: RouteId[] = [
  "project-knowledge",
  "glossary",
  "text-preserve",
  "pre-translation-replacement",
  "post-translation-replacement",
  "custom-prompt",
];

export function ProjectWorkspace({
  project,
  selected,
}: {
  project: ProjectStore;
  selected: RouteId;
}): JSX.Element {
  const { t } = useI18n();
  const { navigate_to_route } = useAppNavigation();
  const { prepare_page_leave } = usePageLeave();
  const registry = useAgentChatRegistry();
  const [left, set_left] = useState<HTMLDivElement | null>(null);
  const { tabs } = useSyncExternalStore(project.subscribe_tabs, project.get_tabs_snapshot);
  const projectId = project.snapshot.projectId;
  const scope = (tabId: RouteId) => ({ projectId, tabId, active: selected === tabId });
  const chat = project.activeChatId
    ? registry.get({ projectId, chatId: project.activeChatId })
    : undefined;

  function close(tabId: RouteId): void {
    void (async () => {
      if (!(await prepare_page_leave({ kind: "project", projectId, tabId }))) return;
      project.close_tab(tabId);
    })().catch((error: unknown) => push_error_toast(t("app.feedback.save_failed"), error));
  }

  function render_action(tabId: RouteId, label: string, Icon?: LucideIcon): ReactNode {
    const open = tabs.includes(tabId);
    return (
      <div
        key={tabId}
        className="project-workspace__action"
        data-open={open}
        data-active={selected === tabId}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={label}
                aria-pressed={selected === tabId}
                className="project-workspace__action-open"
                onClick={() => navigate_to_route(tabId)}
              />
            }
          >
            {Icon && <Icon aria-hidden="true" />}
            <span className="project-workspace__tab-label">{label}</span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <span className="project-workspace__action-close">
          <button
            type="button"
            aria-label={t("app.action.close")}
            tabIndex={open ? 0 : -1}
            disabled={!open}
            onClick={() => close(tabId)}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="project-workspace">
      <div className="project-workspace__toolbar">
        <div
          className="project-workspace__chat-tabs"
          ref={set_left}
          data-active={selected === "agent"}
        />
        <div className="project-workspace__quality-tabs">
          {QUALITY_TABS.filter((tab) => tabs.includes(tab)).map((tab) =>
            render_action(tab, t(SCREEN_REGISTRY[tab].title_key)),
          )}
        </div>
        <div className="project-workspace__anchors">
          {render_action("proofreading", t("proofreading_page.title"), BookOpenCheck)}
          {render_action("files", t("app.workspace.files"), Files)}
          <AppDropdownMenu>
            <AppDropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="project-workspace__rules"
                  aria-label={t("app.workspace.quality_rules")}
                  title={t("app.workspace.quality_rules")}
                >
                  <ShieldCheck aria-hidden="true" />
                  <ChevronDown aria-hidden="true" />
                </button>
              }
            />
            <AppDropdownMenuContent align="end">
              {QUALITY_TABS.map((tab) => (
                <AppDropdownMenuItem key={tab} onClick={() => navigate_to_route(tab)}>
                  {t(SCREEN_REGISTRY[tab].title_key)}
                </AppDropdownMenuItem>
              ))}
            </AppDropdownMenuContent>
          </AppDropdownMenu>
        </div>
      </div>
      <div className="project-workspace__content">
        {chat && (
          <div className="project-workspace__panel" hidden={selected !== "agent"}>
            <ProjectScopeContext value={scope("agent")}>
              <AgentChatProvider store={chat}>
                <AgentPage tabHost={left} active={selected === "agent"} />
              </AgentChatProvider>
            </ProjectScopeContext>
          </div>
        )}
        {tabs.map((tab) => {
          const Page = SCREEN_REGISTRY[tab].component;
          return (
            <div
              key={tab}
              className="project-workspace__panel project-workspace__panel--inset"
              hidden={selected !== tab}
            >
              <ProjectScopeContext value={scope(tab)}>
                <Page />
              </ProjectScopeContext>
            </div>
          );
        })}
      </div>
    </div>
  );
}
