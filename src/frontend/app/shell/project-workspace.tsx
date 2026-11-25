import { useEffect, useLayoutEffect, useRef, useState, type JSX, type RefObject } from "react";
import {
  BadgeCheck,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  BookA,
  BookOpenCheck,
  ChevronDown,
  CopyMinus,
  FilePenLine,
  LayoutDashboard,
  LayoutGrid,
  NotebookText,
  ShieldCheck,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_PROJECT_SETTINGS,
  type ProjectPrefilterSettingKey,
  type ProjectSettings,
} from "@domain/project-settings";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { SCREEN_REGISTRY } from "@frontend/app/navigation/screen-registry";
import type { RouteId } from "@frontend/app/navigation/types";
import { AgentChatStoreContext } from "@frontend/app/session/agent/agent-chat-context";
import type { OpenProjectSnapshot, ProjectStore } from "@frontend/app/state/project-store-registry";
import { is_project_busy } from "@frontend/app/state/runtime-activity-store";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { AgentPage } from "@frontend/pages/agent-page/page";
import { Badge } from "@frontend/shadcn/badge";
import { useWindowDeactivation } from "@frontend/widgets/interactions/use-window-deactivation";
import { ProjectPrefilterSettingDialog } from "./project-prefilter-setting-dialog";
import "@frontend/widgets/inline-action-button.css";
import "./project-workspace.css";

// 工作区达到该宽度才为常驻卡片预留空间，保证主内容的宽度基线。
const TOOLS_DOCK_MIN_WIDTH = 1280;

type WorkspaceToolGroupId = "workbench" | "quality";

type WorkspaceToolRouteItem = Readonly<{
  id: RouteId;
  icon: LucideIcon;
  count?: (snapshot: OpenProjectSnapshot) => number;
}>;

type WorkspaceToolSettingItem = Readonly<{
  field: ProjectPrefilterSettingKey;
  icon: LucideIcon;
}>;

type WorkspaceToolGroupDefinition = Readonly<{
  id: WorkspaceToolGroupId;
  title_key: LocaleKey;
  icon: LucideIcon;
  routeItems: readonly WorkspaceToolRouteItem[];
  settingItems: readonly WorkspaceToolSettingItem[];
}>;

const WORKSPACE_TOOL_GROUPS: readonly WorkspaceToolGroupDefinition[] = [
  {
    id: "workbench",
    title_key: "app.workspace.workbench",
    icon: LayoutGrid,
    routeItems: [
      { id: "proofreading", icon: BookOpenCheck },
      { id: "files", icon: LayoutDashboard, count: (snapshot) => snapshot.file_count },
    ],
    settingItems: [],
  },
  {
    id: "quality",
    title_key: "app.workspace.quality",
    icon: BadgeCheck,
    routeItems: [
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
      { id: "project-knowledge", icon: NotebookText },
      { id: "custom-prompt", icon: FilePenLine },
    ],
    settingItems: [
      { field: "skip_duplicate_source_text_enable", icon: CopyMinus },
      { field: "mtool_optimizer_enable", icon: Zap },
    ],
  },
];

/** 按工作区自身宽度决定功能块是否常驻展开；首帧同步定态，避免切换工程时重放过渡动画。 */
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

    apply_width(node.getBoundingClientRect().width);
    const frame_id = requestAnimationFrame(() => set_animated(true));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) apply_width(entry.contentRect.width);
    });
    observer.observe(node);

    return () => {
      cancelAnimationFrame(frame_id);
      observer.disconnect();
    };
  }, [workspace_ref]);

  return { docked, animated };
}

/** 按工程打开周期挂载，保留对话实例供功能页切回。 */
export function ProjectWorkspace({
  project,
  selected,
}: {
  project: ProjectStore;
  selected: RouteId;
}): JSX.Element {
  const { navigate_to_route } = useAppNavigation();
  const workspace_ref = useRef<HTMLDivElement>(null);
  const tools_anchor_ref = useRef<HTMLDivElement>(null);
  const trigger_refs = useRef<Record<WorkspaceToolGroupId, HTMLButtonElement | null>>({
    workbench: null,
    quality: null,
  });
  const [left, set_left] = useState<HTMLDivElement | null>(null);
  const [open_group, set_open_group] = useState<WorkspaceToolGroupId | null>(null);
  const [prefilter_field, set_prefilter_field] = useState<ProjectPrefilterSettingKey | null>(null);
  const { docked, animated } = use_tools_docked(workspace_ref);
  const FeaturePage = selected === "agent" ? null : SCREEN_REGISTRY[selected].component;
  const { projects } = useRuntimeSnapshot();
  // 确认框打开期间也会收到工程占用变化，入口和提交动作共用同一判断。
  const prefilter_locked = is_project_busy(projects?.[project.snapshot.projectId]);
  const project_settings: ProjectSettings = project.snapshot.settings ?? DEFAULT_PROJECT_SETTINGS;

  // 跨入宽态后清空临时浮层开关，使后续缩窄回临界值以下时菜单一并收起。
  useEffect(() => {
    if (docked) set_open_group(null);
  }, [docked]);

  // 窄态浮层展开期间响应外部点击与 Esc 收起，不干扰宽态常驻卡片。
  useEffect(() => {
    if (docked || open_group === null) return;

    const handle_pointer_down = (event: PointerEvent): void => {
      if (!tools_anchor_ref.current?.contains(event.target as Node)) {
        set_open_group(null);
      }
    };
    const handle_key_down = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const trigger = trigger_refs.current[open_group];
      set_open_group(null);
      trigger?.focus({ preventScroll: true });
    };

    document.addEventListener("pointerdown", handle_pointer_down);
    document.addEventListener("keydown", handle_key_down);
    return () => {
      document.removeEventListener("pointerdown", handle_pointer_down);
      document.removeEventListener("keydown", handle_key_down);
    };
  }, [docked, open_group]);

  useWindowDeactivation(() => {
    if (!docked) set_open_group(null);
  });

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
        <div ref={tools_anchor_ref} className="project-workspace__tools-anchor">
          {WORKSPACE_TOOL_GROUPS.map((group) => (
            <WorkspaceToolGroup
              key={group.id}
              group={group}
              snapshot={project.snapshot}
              settings={project_settings}
              prefilter_locked={prefilter_locked}
              selected={selected}
              docked={docked}
              open={!docked && open_group === group.id}
              register_trigger={(node) => {
                trigger_refs.current[group.id] = node;
              }}
              on_toggle={() =>
                set_open_group((current) => (current === group.id ? null : group.id))
              }
              on_select_route={(route_id) => {
                if (!docked) set_open_group(null);
                navigate_to_route(route_id);
              }}
              on_close_route={() => {
                set_open_group(null);
                navigate_to_route("agent");
              }}
              on_select_prefilter={(field) => {
                if (!docked) set_open_group(null);
                set_prefilter_field(field);
              }}
            />
          ))}
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
      {prefilter_field !== null ? (
        <ProjectPrefilterSettingDialog
          key={prefilter_field}
          field={prefilter_field}
          enabled={project_settings[prefilter_field]}
          runtimeLocked={prefilter_locked}
          onClose={() => set_prefilter_field(null)}
        />
      ) : null}
    </div>
  );
}

/** 工作区同构功能块：头部保持顶栏标签形态，下方卡片在窄态按需浮层展开、宽态纵排常驻。 */
function WorkspaceToolGroup({
  group,
  snapshot,
  settings,
  prefilter_locked,
  selected,
  docked,
  open,
  register_trigger,
  on_toggle,
  on_select_route,
  on_close_route,
  on_select_prefilter,
}: {
  group: WorkspaceToolGroupDefinition;
  snapshot: OpenProjectSnapshot;
  settings: ProjectSettings;
  prefilter_locked: boolean;
  selected: RouteId;
  docked: boolean;
  open: boolean;
  register_trigger: (node: HTMLButtonElement | null) => void;
  on_toggle: () => void;
  on_select_route: (route_id: RouteId) => void;
  on_close_route: () => void;
  on_select_prefilter: (field: ProjectPrefilterSettingKey) => void;
}): JSX.Element {
  const { t } = useI18n();
  const expanded = docked || open;
  const active_route_item = group.routeItems.find((item) => item.id === selected);
  const group_label = t(group.title_key);
  const HeaderIcon = active_route_item?.icon ?? group.icon;
  const header_label =
    active_route_item === undefined
      ? group_label
      : t(SCREEN_REGISTRY[active_route_item.id].title_key);

  const header_content = (
    <>
      <HeaderIcon className="project-workspace__tools-icon" aria-hidden="true" />
      <span className="project-workspace__tools-label">{header_label}</span>
      {active_route_item === undefined && (
        <ChevronDown className="project-workspace__tools-chevron" aria-hidden="true" />
      )}
    </>
  );

  return (
    <nav
      className="project-workspace__tools-panel"
      aria-label={group_label}
      data-group={group.id}
      data-docked={docked}
      data-expanded={expanded}
    >
      <div
        className="project-workspace__tools-header"
        data-active={active_route_item !== undefined}
        data-open={open || undefined}
      >
        {docked ? (
          <div
            className="project-workspace__tools-trigger project-workspace__tools-trigger--static"
            data-active={active_route_item !== undefined}
          >
            {header_content}
          </div>
        ) : (
          <button
            ref={register_trigger}
            type="button"
            className="project-workspace__tools-trigger"
            data-active={active_route_item !== undefined}
            data-open={open || undefined}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={on_toggle}
          >
            {header_content}
          </button>
        )}
        {active_route_item !== undefined && (
          <button
            type="button"
            className="inline-action-button project-workspace__tools-close"
            aria-label={t("app.action.close")}
            onClick={on_close_route}
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
                aria-label={group_label}
              >
                {group.routeItems.map((item) => {
                  const Icon = item.icon;
                  const count = item.count?.(snapshot);
                  const active = selected === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role={docked ? undefined : "menuitem"}
                      className="project-workspace__tool-item"
                      data-active={active || undefined}
                      aria-current={docked && active ? "page" : undefined}
                      onClick={() => on_select_route(item.id)}
                    >
                      <Icon className="project-workspace__tool-icon" aria-hidden="true" />
                      <span className="project-workspace__tool-label">
                        {t(SCREEN_REGISTRY[item.id].title_key)}
                      </span>
                      {count !== undefined && (
                        <Badge className="project-workspace__tool-count">{count}</Badge>
                      )}
                    </button>
                  );
                })}
                {group.settingItems.length > 0 ? (
                  <>
                    <div className="project-workspace__tools-divider" role="separator" />
                    {group.settingItems.map((item) => {
                      const Icon = item.icon;
                      const enabled = settings[item.field];
                      return (
                        <button
                          key={item.field}
                          type="button"
                          role={docked ? undefined : "menuitem"}
                          className="project-workspace__tool-item"
                          disabled={prefilter_locked}
                          onClick={() => on_select_prefilter(item.field)}
                        >
                          <Icon className="project-workspace__tool-icon" aria-hidden="true" />
                          <span className="project-workspace__tool-label">
                            {t(`app.project_prefilter.${item.field}.title`)}
                          </span>
                          <Badge
                            tone={enabled ? "brand" : "neutral"}
                            className="project-workspace__tool-badge"
                          >
                            {t(enabled ? "app.state.enabled" : "app.state.disabled")}
                          </Badge>
                        </button>
                      );
                    })}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
