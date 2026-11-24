import { useState, type JSX, type DragEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileClock,
  FileInput,
  FilePlus,
  Plus,
  SquarePower,
  X,
} from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { useProjectPreview } from "@frontend/features/project-lifecycle/use-project-preview";
import { ProjectPreviewSummary } from "@frontend/features/project-lifecycle/project-preview";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";
import { AppButton } from "@frontend/widgets/app-button";
import { read_file_paths } from "@frontend/app/desktop/source-paths";
import "./project-sidebar.css";

const RECENT_LIMIT = 5;
const path_key = (file: string): string => {
  const normalized = file.replaceAll("\\", "/");
  return navigator.platform.toLowerCase().includes("win") ? normalized.toLowerCase() : normalized;
};

export function ProjectSidebar({
  before_select,
  select,
}: {
  before_select: (project: ProjectStore) => Promise<boolean>;
  select: (project: ProjectStore, chatId?: string) => Promise<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const { settings_snapshot, open_projects, active_project, apply_chat_list } = useDesktopState();
  const runtime = useRuntimeSnapshot();
  const lifecycle = useProjectLifecycle();
  const [collapsed, set_collapsed] = useState(new Set<string>());
  const [removing, set_removing] = useState<{ projectId: string; chatId: string } | null>(null);
  const [pending, set_pending] = useState(false);
  const paths = new Set(open_projects.map(({ snapshot }) => path_key(snapshot.path)));
  const recent = settings_snapshot.recent_projects
    .filter((project) => {
      const key = path_key(project.path);
      if (paths.has(key)) return false;
      paths.add(key);
      return true;
    })
    .slice(0, RECENT_LIMIT);

  function show_error(error: unknown): void {
    push_error_toast(t("app.feedback.update_failed"), error);
  }

  async function create(project: ProjectStore): Promise<void> {
    // 切换工程或离开全局页时先保存脏编辑器，离页被阻断时不创建孤立对话。
    if (!(await before_select(project))) return;
    const projectId = project.snapshot.projectId;
    const result = await api_fetch("/api/agent/chats/create", { projectId });
    apply_chat_list(projectId, result);
    set_collapsed((before) => {
      const next = new Set(before);
      next.delete(projectId);
      return next;
    });
    await select(project, project.activeChatId);
  }

  async function delete_chat(): Promise<void> {
    if (!removing || pending) return;
    set_pending(true);
    try {
      const result = await api_fetch("/api/agent/chats/delete", removing);
      apply_chat_list(removing.projectId, result);
      set_removing(null);
    } catch (error) {
      show_error(error);
    } finally {
      set_pending(false);
    }
  }

  return (
    <section
      className="project-sidebar"
      onDragOver={accept_project_drop}
      onDrop={(event) =>
        route_project_drop(event, lifecycle, open_projects.length === 0, () =>
          push_toast("warning", t("agent_page.error.invalid_file_path")),
        )
      }
    >
      <div className="project-sidebar__heading">
        <span>{t("agent_page.document.conversation")}</span>
        <button
          type="button"
          className="project-sidebar__icon"
          title={t("project.create.title")}
          aria-label={t("project.create.title")}
          disabled={lifecycle.busy}
          onClick={lifecycle.show_create_dialog}
        >
          <FilePlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="project-sidebar__icon"
          title={t("project.open.title")}
          aria-label={t("project.open.title")}
          disabled={lifecycle.busy}
          onClick={() => lifecycle.request_open()}
        >
          <FileInput aria-hidden="true" />
        </button>
      </div>
      <ul>
        {open_projects.map((project) => {
          const { projectId, name, path } = project.snapshot;
          const activity = runtime.projects?.[projectId];
          const busy = Boolean(
            activity?.projectWrite || activity?.batchTranslation || activity?.activeChatCount,
          );
          const expanded = !collapsed.has(projectId);
          const close_label = t(busy ? "app.workspace.close_busy" : "project.close.action");
          return (
            <li key={projectId}>
              <div className="project-sidebar__row" data-active={active_project === project}>
                <button
                  type="button"
                  className="project-sidebar__icon"
                  aria-expanded={expanded}
                  aria-label={name}
                  onClick={() =>
                    set_collapsed((before) => {
                      const next = new Set(before);
                      if (expanded) next.add(projectId);
                      else next.delete(projectId);
                      return next;
                    })
                  }
                >
                  {expanded ? (
                    <ChevronDown aria-hidden="true" />
                  ) : (
                    <ChevronRight aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="project-sidebar__label"
                  title={path}
                  onClick={() => void select(project).catch(show_error)}
                >
                  <span>{name}</span>
                </button>
                <button
                  type="button"
                  className="project-sidebar__icon"
                  title={t("app.workspace.new_chat")}
                  aria-label={t("app.workspace.new_chat")}
                  onClick={() => void create(project).catch(show_error)}
                >
                  <Plus aria-hidden="true" />
                </button>
                <span title={close_label}>
                  <button
                    type="button"
                    className="project-sidebar__icon"
                    aria-label={close_label}
                    disabled={busy || lifecycle.busy}
                    onClick={() => lifecycle.request_close(projectId)}
                  >
                    <SquarePower aria-hidden="true" />
                  </button>
                </span>
              </div>
              {expanded && (
                <ul className="project-sidebar__chats">
                  {project.chats.map((chat) => (
                    <li
                      className="project-sidebar__row"
                      key={chat.id}
                      data-active={active_project === project && project.activeChatId === chat.id}
                    >
                      <button
                        type="button"
                        className="project-sidebar__label"
                        onClick={() => void select(project, chat.id).catch(show_error)}
                      >
                        <span
                          className="project-sidebar__state"
                          aria-hidden="true"
                          data-state={
                            chat.hasPendingDecision
                              ? "pending"
                              : chat.status !== "idle"
                                ? "running"
                                : chat.stoppedOnError
                                  ? "error"
                                  : undefined
                          }
                        />
                        <span>{chat.title || t("app.workspace.new_chat")}</span>
                      </button>
                      <button
                        type="button"
                        className="project-sidebar__icon"
                        title={t("app.workspace.delete_chat")}
                        aria-label={t("app.workspace.delete_chat")}
                        disabled={chat.status !== "idle"}
                        onClick={() => set_removing({ projectId, chatId: chat.id })}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {recent.map((project) => (
          <RecentProject key={project.path} {...project} />
        ))}
      </ul>
      <AppConfirmDialog
        open={removing !== null}
        submitting={pending}
        description={t("app.workspace.delete_chat")}
        onConfirm={delete_chat}
        onClose={() => set_removing(null)}
      />
    </section>
  );
}

function RecentProject({ name, path }: { name: string; path: string }): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  const [open, set_open] = useState(false);
  const preview = useProjectPreview(open ? path : null);
  return (
    <li className="project-sidebar__row">
      <Tooltip open={open} onOpenChange={set_open}>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="project-sidebar__label"
              disabled={lifecycle.busy}
              onClick={() => lifecycle.open_recent_project(path)}
            />
          }
        >
          <FileClock aria-hidden="true" />
          <span>{name}</span>
        </TooltipTrigger>
        <TooltipContent side="right" className="project-sidebar__preview project-lifecycle">
          <p className="break-all">{path}</p>
          {(preview.status === "loading" || preview.status === "ready") && (
            <ProjectPreviewSummary preview={preview.status === "ready" ? preview.preview : null} />
          )}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        className="project-sidebar__icon"
        title={t("app.action.delete")}
        aria-label={t("app.action.delete")}
        disabled={lifecycle.busy}
        onClick={() => lifecycle.remove_recent_project(path)}
      >
        <X aria-hidden="true" />
      </button>
    </li>
  );
}

function accept_project_drop(event: DragEvent<HTMLElement>): void {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
}

function route_project_drop(
  event: DragEvent<HTMLElement>,
  lifecycle: ReturnType<typeof useProjectLifecycle>,
  accept_sources: boolean,
  on_invalid: () => void,
): void {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  if (lifecycle.busy) return;
  const { paths, skipped } = read_file_paths(Array.from(event.dataTransfer.files));
  if (skipped.length > 0) {
    on_invalid();
    return;
  }
  if (paths.length === 1 && paths[0]!.toLowerCase().endsWith(".lg"))
    lifecycle.request_open(paths[0]);
  else if (accept_sources && paths.length > 0) lifecycle.create_from_paths(paths);
}

export function ProjectWelcome(): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  return (
    <section
      className="project-welcome"
      onDragOver={accept_project_drop}
      onDrop={(event) =>
        route_project_drop(event, lifecycle, true, () =>
          push_toast("warning", t("agent_page.error.invalid_file_path")),
        )
      }
    >
      <h1>{t("agent_page.empty.message")}</h1>
      <div className="project-welcome__actions">
        <AppButton onClick={() => lifecycle.request_open()} disabled={lifecycle.busy}>
          {t("project.open.title")}
        </AppButton>
        <AppButton
          variant="outline"
          onClick={lifecycle.show_create_dialog}
          disabled={lifecycle.busy}
        >
          {t("project.create.title")}
        </AppButton>
      </div>
    </section>
  );
}
