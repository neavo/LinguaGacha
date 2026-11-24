import { useEffect, useEffectEvent, type JSX } from "react";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { ProjectPreviewSummary } from "./project-preview";
import { useProjectPreview } from "./use-project-preview";

/** 打开工程前的预览确认框；最近记录缺失时直接转交常驻流程提供移除确认。 */
export function ProjectOpenPreviewDialog({
  path,
  from_recent = false,
  on_close,
}: {
  path: string;
  from_recent?: boolean;
  on_close: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  const preview = useProjectPreview(path);
  const error = preview.status === "failed" ? preview.error : undefined;

  const handle_error = useEffectEvent((failure: unknown) => {
    if (from_recent && failure instanceof DesktopApiError && failure.code === "project.not_found") {
      on_close();
      lifecycle.open_recent_project(path);
      return;
    }
    push_error_toast(t("app.feedback.load_failed"), failure);
  });

  useEffect(() => {
    if (error !== undefined) handle_error(error);
  }, [error]);

  const can_open = preview.status === "ready" && !lifecycle.busy;
  return (
    <AppActionDialog
      open
      contentClassName="project-lifecycle"
      description={<span className="break-all">{path}</span>}
      details={
        preview.status === "failed" ? (
          <p>{t("app.feedback.load_failed")}</p>
        ) : (
          <ProjectPreviewSummary preview={preview.status === "ready" ? preview.preview : null} />
        )
      }
      primaryAction={{
        label: t("app.action.open"),
        disabled: !can_open,
        onSelect: () => {
          on_close();
          if (from_recent) lifecycle.open_recent_project(path);
          else lifecycle.request_open(path);
        },
      }}
      onClose={on_close}
    />
  );
}
