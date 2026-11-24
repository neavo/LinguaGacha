import { useEffect, useLayoutEffect, useRef, useState, type JSX, type RefObject } from "react";
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
import { useWindowDeactivation } from "@frontend/widgets/interactions/use-window-deactivation";
import "@frontend/widgets/inline-action-button.css";
import "./project-workspace.css";

// 工作区宽于该阈值时将右侧菜单常驻展开为 240px 功能卡片，同时保留不少于 1024px 的主内容基线宽度。
const TOOLS_DOCK_MIN_WIDTH = 1280;

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

/** 按工作区自身宽度决定翻译功能菜单是否常驻展开；首帧同步定态，避免切换工程时重放过渡动画。 */
function use_tools_docked(workspace_ref: RefObject<HTMLDivElement | null>): {
  docked: boolean;
  animated: boolean;
} {
  const [docked, set_docked] = useState(false);
  const [animated, set_animated] = useState(false);

  useLayoutEffect(() => {
    const node = workspace_ref.current;
    if (!node) return;

    const apply_width = (width: number): void => {
      if (width <= 0) return;
      set_docked(width >= TOOLS_DOCK_MIN_WIDTH);
    };

    apply_width(node.getBoundingClientRect().width || node.clientWidth);
    const frame_id = requestAnimationFrame(() => set_animated(true));
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      const width =
        entry?.contentRect.width || node.getBoundingClientRect().width || node.clientWidth;
      apply_width(width);
    });
    observer.observe(node);

    return () => {
      cancelAnimationFrame(frame_id);
      observer.disconnect();
    };
  }, [workspace_ref]);

  return { docked, animated };
}

/** 工程工作区：左侧承载对话与预览标签，右侧标签在窄态点击展开菜单、宽态原地常驻展开下方功能卡片。 */
export function ProjectWorkspace({
  project,
  selected,
}: {
  project: ProjectStore;
  selected: RouteId;
}): JSX.Element {
  const { navigate_to_route } = useAppNavigation();
  const workspace_ref = useRef<HTMLDivElement>(null);
  const [left, set_left] = useState<HTMLDivElement | null>(null);
  const { docked, animated } = use_tools_docked(workspace_ref);
  const FeaturePage = selected === "agent" ? null : SCREEN_REGISTRY[selected].component;

  return (
    <div
      ref={workspace_ref}
      className="project-workspace"
      data-tools-docked={docked}
      data-tools-animated={animated || undefined}
    >
      <div className="project-workspace__toolbar">
        <div
          className="project-workspace__chat-tabs"
          ref={set_left}
          data-active={selected === "agent"}
        />
        <div className="project-workspace__tools-anchor">
          <TranslationToolsPanel
            snapshot={project.snapshot}
            selected={selected}
            docked={docked}
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

/** 单一翻译功能面板：头部始终保持顶栏标签样式，下方菜单在窄态按需展开、宽态自动向下常驻为功能卡片。 */
function TranslationToolsPanel({
  snapshot,
  selected,
  docked,
  on_select,
  on_close,
}: {
  snapshot: OpenProjectSnapshot;
  selected: RouteId;
  docked: boolean;
  on_select: (route_id: RouteId) => void;
  on_close: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const panel_ref = useRef<HTMLElement>(null);
  const trigger_ref = useRef<HTMLButtonElement>(null);
  const [open, set_open] = useState(false);

  const expanded = docked || open;
  const active_tool = selected === "agent" ? undefined : TRANSLATION_TOOL_BY_ID.get(selected);
  const HeaderIcon = active_tool?.icon ?? LayoutGrid;
  const header_label =
    active_tool === undefined
      ? t("app.workspace.translation_tools")
      : t(SCREEN_REGISTRY[active_tool.id].title_key);

  // 跨入宽态后清空临时浮层开关，使后续缩窄回临界值以下时菜单一并顺滑向上收起。
  useEffect(() => {
    if (docked) set_open(false);
  }, [docked]);

  // 窄态浮层展开期间响应外部点击与 Esc 收起，不干扰宽态常驻卡片。
  useEffect(() => {
    if (docked || !open) return;

    const handle_pointer_down = (event: PointerEvent): void => {
      if (!panel_ref.current?.contains(event.target as Node)) {
        set_open(false);
      }
    };
    const handle_key_down = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      set_open(false);
      trigger_ref.current?.focus({ preventScroll: true });
    };

    document.addEventListener("pointerdown", handle_pointer_down);
    document.addEventListener("keydown", handle_key_down);
    return () => {
      document.removeEventListener("pointerdown", handle_pointer_down);
      document.removeEventListener("keydown", handle_key_down);
    };
  }, [docked, open]);

  useWindowDeactivation(() => {
    if (!docked) set_open(false);
  });

  return (
    <nav
      ref={panel_ref}
      className="project-workspace__tools-panel"
      aria-label={t("app.workspace.translation_tools")}
      data-docked={docked}
      data-expanded={expanded}
    >
      <div
        className="project-workspace__tools-header"
        data-active={active_tool !== undefined}
        data-open={(!docked && open) || undefined}
      >
        {docked ? (
          <div
            className="project-workspace__tools-trigger project-workspace__tools-trigger--static"
            data-active={active_tool !== undefined}
          >
            <HeaderIcon className="project-workspace__tools-icon" aria-hidden="true" />
            <span className="project-workspace__tools-label">{header_label}</span>
            {active_tool === undefined && (
              <ChevronDown
                className="project-workspace__tools-chevron project-workspace__tools-chevron--hidden"
                aria-hidden="true"
              />
            )}
          </div>
        ) : (
          <button
            ref={trigger_ref}
            type="button"
            className="project-workspace__tools-trigger"
            data-active={active_tool !== undefined}
            data-open={open || undefined}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => set_open((current) => !current)}
          >
            <HeaderIcon className="project-workspace__tools-icon" aria-hidden="true" />
            <span className="project-workspace__tools-label">{header_label}</span>
            {active_tool === undefined && (
              <ChevronDown className="project-workspace__tools-chevron" aria-hidden="true" />
            )}
          </button>
        )}
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

      <div
        className="project-workspace__tools-drawer"
        aria-hidden={!expanded || undefined}
        inert={!expanded}
      >
        <div className="project-workspace__tools-drawer-inner">
          <div className="project-workspace__tools-card-frame">
            <div className="project-workspace__tools-card">
              <div
                className="project-workspace__tools-list"
                role={docked ? undefined : "menu"}
                aria-label={t("app.workspace.translation_tools")}
              >
                {TRANSLATION_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  const count = tool.count?.(snapshot);
                  const active = selected === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      role={docked ? undefined : "menuitem"}
                      className="project-workspace__tool-item"
                      data-active={active || undefined}
                      aria-current={docked && active ? "page" : undefined}
                      onClick={() => {
                        if (!docked) set_open(false);
                        on_select(tool.id);
                      }}
                    >
                      <Icon className="project-workspace__tool-icon" aria-hidden="true" />
                      <span className="project-workspace__tool-label">
                        {t(SCREEN_REGISTRY[tool.id].title_key)}
                      </span>
                      {count !== undefined && (
                        <Badge className="project-workspace__tool-count">{count}</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
