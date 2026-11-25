import { useState, useSyncExternalStore, type JSX, type ReactNode, type RefObject } from "react";
import {
  Ellipsis,
  FileInput,
  FilePlus,
  FolderOpen,
  ListX,
  PackageOpen,
  SquarePower,
} from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_project_busy } from "@frontend/app/state/runtime-activity-store";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { ProjectOpenPreviewDialog } from "@frontend/features/project-lifecycle/project-open-preview-dialog";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { Tooltip, TooltipContent, TooltipTarget, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";
import type { AgentChatStore } from "@frontend/app/session/agent/agent-chat-store";
import { read_file_paths } from "@frontend/app/desktop/source-paths";
import { CountdownRing } from "@frontend/widgets/countdown-ring/countdown-ring";
import { FileDropTarget } from "@frontend/widgets/interactions/file-drop-target";
import "@frontend/widgets/inline-action-button.css";
import "@frontend/widgets/status-mark.css";

/** 已打开工程的倒计时逐秒更新，重渲染范围限于状态指示器。 */
function OpenProjectStatusMark({
  store,
  busy,
}: {
  store: AgentChatStore;
  busy: boolean;
}): JSX.Element {
  const countdown = useSyncExternalStore(store.subscribe_countdown, store.get_countdown);

  if (countdown !== null) {
    return <CountdownRing size="sm" remaining_percent={countdown.remainingPercent} aria-hidden />;
  }

  return (
    <span
      className={busy ? "status-mark status-mark--pulse" : "status-mark"}
      data-status={busy ? "busy" : "open"}
      aria-hidden="true"
    />
  );
}

/** 最近记录与打开列表来自不同入口，Windows 路径按大小写不敏感的方式比较。 */
function path_key(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  return navigator.platform.toLowerCase().includes("win") ? normalized.toLowerCase() : normalized;
}

/** 打开工程与最近工程共用列表，打开确认绑定发起操作时的目标。 */
export function ProjectSidebar({
  project_view_active,
  select,
}: {
  project_view_active: boolean;
  select: (project: ProjectStore) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const { settings_snapshot, open_projects, active_project } = useDesktopState();
  const { projects } = useRuntimeSnapshot();
  const lifecycle = useProjectLifecycle();
  const [opening_path, set_opening_path] = useState<string | null>(null);
  const paths = new Set(open_projects.map(({ snapshot }) => path_key(snapshot.path))); // 重复路径保留已打开项。
  const recent = settings_snapshot.recent_projects.filter(({ path }) => {
    const key = path_key(path);
    if (paths.has(key)) return false;
    paths.add(key);
    return true;
  });
  const has_projects = open_projects.length > 0 || recent.length > 0;

  return (
    <section className="shell-sidebar__projects">
      <hr className="sidebar-group-separator" />
      <div className="sidebar-projects__header">
        <span className="sidebar-projects__title">{t("app.workspace.projects")}</span>
        {/* 每次引导都重建按钮容器，重新播放提示动画。 */}
        <div className="sidebar-projects__header-actions">
          <Tooltip>
            <TooltipTrigger
              render={
                <TooltipTarget>
                  <button
                    type="button"
                    className="inline-action-button"
                    aria-label={t("project.create.title")}
                    disabled={lifecycle.busy}
                    onClick={lifecycle.request_create}
                  >
                    <FilePlus aria-hidden="true" />
                  </button>
                </TooltipTarget>
              }
            />
            <TooltipContent>{t("project.create.title")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <TooltipTarget>
                  <button
                    type="button"
                    className="inline-action-button"
                    aria-label={t("project.open.title")}
                    disabled={lifecycle.busy}
                    onClick={() => lifecycle.request_open()}
                  >
                    <FileInput aria-hidden="true" />
                  </button>
                </TooltipTarget>
              }
            />
            <TooltipContent>{t("project.open.title")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="shell-sidebar__project-scroll">
        {has_projects ? (
          <ul className="sidebar-group">
            {open_projects.map((project) => (
              <ProjectRow
                key={path_key(project.snapshot.path)}
                name={project.snapshot.name}
                path={project.snapshot.path}
                project={project}
                busy={is_project_busy(projects?.[project.snapshot.projectId])}
                selected={project_view_active && active_project === project}
                on_select={() => {
                  void select(project).catch((error: unknown) =>
                    push_error_toast(t("app.feedback.save_failed"), error),
                  );
                }}
              />
            ))}
            {recent.map(({ path, name }) => (
              <ProjectRow
                key={path_key(path)}
                name={name}
                path={path}
                on_select={() => set_opening_path(path)}
              />
            ))}
          </ul>
        ) : (
          <div className="sidebar-projects__empty">
            <PackageOpen className="sidebar-projects__empty-icon" aria-hidden="true" />
            <p className="sidebar-projects__empty-label">{t("app.workspace.projects_empty")}</p>
          </div>
        )}
      </div>
      {opening_path !== null && (
        <ProjectOpenPreviewDialog
          path={opening_path}
          from_recent
          on_close={() => set_opening_path(null)}
        />
      )}
    </section>
  );
}

/** 同一条目在打开前后保留路径身份与操作布局。 */
function ProjectRow({
  name,
  path,
  project,
  selected = false,
  busy = false,
  on_select,
}: {
  name: string;
  path: string;
  project?: ProjectStore;
  selected?: boolean;
  busy?: boolean;
  on_select: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  const [menu_open, set_menu_open] = useState(false);
  const projectId = project?.snapshot.projectId;
  const disabled = busy || lifecycle.busy;
  const close_label = t("project.close.action");
  const remove_label = t("app.workspace.remove_recent");
  const reveal_label = t("app.workspace.reveal_path");

  /** 未打开的最近工程也可直接定位磁盘文件。 */
  function reveal(): void {
    void window.desktopApp.revealPath(path).catch((error: unknown) => {
      push_error_toast(t("app.feedback.activate_link"), error);
    });
  }

  /** 空闲菜单项文字自解释，仅在繁忙禁用时通过 Tooltip 说明原因。 */
  function project_action(icon: ReactNode, label: string, on_click: () => void): JSX.Element {
    const item = (
      <AppDropdownMenuItem
        disabled={disabled}
        className={busy ? "sidebar-project-item__menu-action" : undefined}
        onClick={on_click}
      >
        {icon}
        {label}
      </AppDropdownMenuItem>
    );
    if (!busy) return item;
    return (
      <Tooltip>
        <TooltipTrigger render={item} />
        <TooltipContent>{t("app.workspace.close_busy")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <li className="sidebar-project-item" data-menu-open={menu_open || undefined}>
      <Tooltip disabled={menu_open}>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="sidebar-row"
              aria-current={selected ? "page" : undefined}
              data-active={selected}
              disabled={lifecycle.busy}
              onClick={on_select}
            />
          }
        >
          {project === undefined ? (
            <span className="status-mark" data-status="closed" aria-hidden="true" />
          ) : (
            <OpenProjectStatusMark store={project.agentChat} busy={busy} />
          )}
          <span className="sidebar-row__label">{name}</span>
        </TooltipTrigger>
        <TooltipContent side="right">{path}</TooltipContent>
      </Tooltip>
      <div className="sidebar-project-item__actions">
        <AppDropdownMenu open={menu_open} onOpenChange={set_menu_open}>
          <Tooltip>
            <TooltipTrigger
              render={
                <AppDropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="inline-action-button"
                      aria-label={t("app.workspace.more")}
                    >
                      <Ellipsis aria-hidden="true" />
                    </button>
                  }
                />
              }
            />
            <TooltipContent>{t("app.workspace.more")}</TooltipContent>
          </Tooltip>
          <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
            {projectId !== undefined &&
              project_action(<SquarePower aria-hidden="true" />, close_label, () =>
                lifecycle.request_close(projectId),
              )}
            {project_action(<ListX aria-hidden="true" />, remove_label, () =>
              projectId === undefined
                ? lifecycle.remove_recent_project(path)
                : lifecycle.request_close(projectId, path),
            )}
            <AppDropdownMenuItem onClick={reveal}>
              <FolderOpen aria-hidden="true" />
              {reveal_label}
            </AppDropdownMenuItem>
          </AppDropdownMenuContent>
        </AppDropdownMenu>
      </div>
    </li>
  );
}

/** 左栏接入工程文件，侧栏中的固定区与滚动区共享同一拖放目标。 */
export function ProjectSidebarDrop({ target_ref }: { target_ref: RefObject<HTMLElement | null> }) {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();

  /** 只接受单个工程文件，打开流程统一处理版本确认和失败反馈。 */
  function open_project(files: readonly File[]): void {
    const { paths, skipped } = read_file_paths(files);
    if (skipped.length > 0) {
      push_toast("warning", t("agent_page.error.invalid_file_path"));
    } else if (paths.length > 1) {
      push_toast("warning", t("app.drop.multiple_unavailable"));
    } else if (paths[0]?.toLowerCase().endsWith(".lg")) {
      lifecycle.request_open(paths[0]);
    } else if (paths.length > 0) {
      push_toast("warning", t("app.drop.project_only"));
    }
  }

  return (
    <FileDropTarget
      target_ref={target_ref}
      enabled={!lifecycle.busy}
      on_files={open_project}
      label={t("app.drop.release")}
    />
  );
}
