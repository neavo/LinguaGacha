import { useState, type JSX } from "react";
import { FileClock, FileInput, FilePlus, X } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { ProjectPreviewSummary } from "@frontend/features/project-lifecycle/project-preview";
import { useProjectPreview } from "@frontend/features/project-lifecycle/use-project-preview";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

const RECENT_PROJECT_LIMIT = 5;

/** 每次展开重新读取预览。关闭提示即撤销请求。 */
function RecentProjectEntry(props: { path: string; name: string }): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  const [open, set_open] = useState(false);
  const preview = useProjectPreview(open ? props.path : null);
  return (
    <span className="agent-project-entry__recent">
      <Tooltip open={open} onOpenChange={set_open}>
        <TooltipTrigger
          render={
            <AppButton
              variant="secondary"
              size="sm"
              className="agent-project-entry__recent-open"
              disabled={lifecycle.busy}
              onClick={() => lifecycle.open_recent_project(props.path)}
            />
          }
        >
          <FileClock aria-hidden="true" />
          <span className="min-w-0 truncate">{props.name}</span>
        </TooltipTrigger>
        <TooltipContent align="start" className="agent-project-entry__preview project-lifecycle">
          <p className="break-all">{props.path}</p>
          {(preview.status === "loading" || preview.status === "ready") && (
            <ProjectPreviewSummary preview={preview.status === "ready" ? preview.preview : null} />
          )}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        className="agent-project-entry__recent-remove"
        aria-label={t("app.action.delete")}
        disabled={lifecycle.busy}
        onClick={() => lifecycle.remove_recent_project(props.path)}
      >
        <X aria-hidden="true" />
      </button>
    </span>
  );
}

/** 无工程时集中提供唯一入口，抖动由父组件重挂载触发。 */
export function AgentProjectEntry(props: { attention: number }): JSX.Element | null {
  const { t } = useI18n();
  const { project_snapshot, settings_snapshot } = useDesktopState();
  const lifecycle = useProjectLifecycle();
  if (project_snapshot.loaded) return null;
  const recent_projects = settings_snapshot.recent_projects.slice(0, RECENT_PROJECT_LIMIT);
  return (
    <div className="agent-project-entry" data-attention={props.attention > 0 || undefined}>
      <AppButton
        variant="outline"
        size="sm"
        disabled={lifecycle.busy}
        onClick={lifecycle.show_create_dialog}
      >
        <FilePlus aria-hidden="true" />
        {t("project.create.title")}
      </AppButton>
      <AppButton
        variant="outline"
        size="sm"
        disabled={lifecycle.busy}
        onClick={() => lifecycle.request_open()}
      >
        <FileInput aria-hidden="true" />
        {t("project.open.title")}
      </AppButton>
      {recent_projects.map((project) => (
        <RecentProjectEntry key={project.path} {...project} />
      ))}
    </div>
  );
}
