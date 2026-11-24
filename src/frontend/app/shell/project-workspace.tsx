import { useState, type JSX } from "react";
import {
  BetweenVerticalEnd,
  BetweenVerticalStart,
  BookA,
  BookOpenCheck,
  Brain,
  ChevronDown,
  FilePenLine,
  LayoutDashboard,
  LayoutGrid,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import type { RouteId } from "@frontend/app/navigation/types";
import { SCREEN_REGISTRY } from "@frontend/app/navigation/screen-registry";
import { AgentChatStoreContext } from "@frontend/app/session/agent/agent-chat-context";
import { AgentPage } from "@frontend/pages/agent-page/page";
import type { OpenProjectSnapshot, ProjectStore } from "@frontend/app/state/project-store-registry";
import { Badge } from "@frontend/shadcn/badge";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import "@frontend/widgets/inline-action-button.css";
import "./project-workspace.css";

type TranslationToolDefinition = Readonly<{
  id: RouteId;
  icon: LucideIcon;
  count?: (snapshot: OpenProjectSnapshot) => number;
}>;

const TRANSLATION_TOOLS: readonly TranslationToolDefinition[] = [
  { id: "proofreading", icon: BookOpenCheck },
  { id: "files", icon: LayoutDashboard, count: (snapshot) => snapshot.file_count },
  { id: "glossary", icon: BookA, count: (snapshot) => snapshot.quality_rule_counts.glossary },
  {
    id: "text-preserve",
    icon: ShieldCheck,
    count: (snapshot) => snapshot.quality_rule_counts.text_preserve,
  },
  {
    id: "pre-translation-replacement",
    icon: BetweenVerticalStart,
    count: (snapshot) => snapshot.quality_rule_counts.pre_replacement,
  },
  {
    id: "post-translation-replacement",
    icon: BetweenVerticalEnd,
    count: (snapshot) => snapshot.quality_rule_counts.post_replacement,
  },
  { id: "project-knowledge", icon: Brain },
  { id: "custom-prompt", icon: FilePenLine },
];

const TRANSLATION_TOOL_BY_ID = new Map<RouteId, TranslationToolDefinition>(
  TRANSLATION_TOOLS.map((tool) => [tool.id, tool]),
);

/** 工程工作区：左侧承载对话与预览标签，右侧以单一翻译功能菜单切换工程页面。 */
export function ProjectWorkspace({
  project,
  selected,
}: {
  project: ProjectStore;
  selected: RouteId;
}): JSX.Element {
  const { navigate_to_route } = useAppNavigation();
  const [left, set_left] = useState<HTMLDivElement | null>(null);
  const FeaturePage = selected === "agent" ? null : SCREEN_REGISTRY[selected].component;

  return (
    <div className="project-workspace">
      <div className="project-workspace__toolbar">
        <div
          className="project-workspace__chat-tabs"
          ref={set_left}
          data-active={selected === "agent"}
        />
        <div className="project-workspace__tools">
          <TranslationToolsMenu
            snapshot={project.snapshot}
            selected={selected}
            on_select={(route_id) => navigate_to_route(route_id)}
            on_close={() => navigate_to_route("agent")}
          />
        </div>
      </div>
      <div className="project-workspace__content">
        <div className="project-workspace__panel" hidden={selected !== "agent"}>
          <AgentChatStoreContext value={project.agentChat}>
            <AgentPage tabHost={left} active={selected === "agent"} />
          </AgentChatStoreContext>
        </div>
        {FeaturePage !== null && (
          <div key={selected} className="project-workspace__panel project-workspace__panel--inset">
            <FeaturePage />
          </div>
        )}
      </div>
    </div>
  );
}

/** 翻译功能入口仅响应点击展开或收缩，展开功能页后保留关闭按钮且点击标签本体可直接切换其它功能。 */
function TranslationToolsMenu({
  snapshot,
  selected,
  on_select,
  on_close,
}: {
  snapshot: OpenProjectSnapshot;
  selected: RouteId;
  on_select: (route_id: RouteId) => void;
  on_close: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [open, set_open] = useState(false);
  const active_tool = selected === "agent" ? undefined : TRANSLATION_TOOL_BY_ID.get(selected);
  const TriggerIcon = active_tool?.icon ?? LayoutGrid;
  const trigger_label =
    active_tool === undefined
      ? t("app.workspace.translation_tools")
      : t(SCREEN_REGISTRY[active_tool.id].title_key);

  return (
    <AppDropdownMenu open={open} onOpenChange={set_open}>
      <div
        className="project-workspace__tools-group"
        data-active={active_tool !== undefined}
        data-open={open || undefined}
      >
        <AppDropdownMenuTrigger
          render={
            <button
              type="button"
              className="project-workspace__tools-trigger"
              data-active={active_tool !== undefined}
              data-open={open || undefined}
            >
              <TriggerIcon className="project-workspace__tools-icon" aria-hidden="true" />
              <span className="project-workspace__tools-label">{trigger_label}</span>
              {active_tool === undefined && (
                <ChevronDown className="project-workspace__tools-chevron" aria-hidden="true" />
              )}
            </button>
          }
        />
        {active_tool !== undefined && (
          <button
            type="button"
            className="inline-action-button project-workspace__tools-close"
            aria-label={t("app.action.close")}
            onClick={() => {
              set_open(false);
              on_close();
            }}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <AppDropdownMenuContent
        align="end"
        matchTriggerWidth={false}
        className="project-workspace__tools-menu"
      >
        {TRANSLATION_TOOLS.map((tool) => {
          const Icon = tool.icon;
          const count = tool.count?.(snapshot);
          return (
            <AppDropdownMenuItem
              key={tool.id}
              className="project-workspace__tool-item"
              data-active={selected === tool.id || undefined}
              onClick={() => on_select(tool.id)}
            >
              <Icon aria-hidden="true" />
              <span className="project-workspace__tool-label">
                {t(SCREEN_REGISTRY[tool.id].title_key)}
              </span>
              {count !== undefined && (
                <Badge className="project-workspace__tool-count">{count}</Badge>
              )}
            </AppDropdownMenuItem>
          );
        })}
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
