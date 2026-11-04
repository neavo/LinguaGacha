import { useEffect, useEffectEvent, type JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { ProjectPreviewSummary } from "@frontend/features/project-lifecycle/project-preview";
import { useProjectPreview } from "@frontend/features/project-lifecycle/use-project-preview";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { Spinner } from "@frontend/shadcn/spinner";

/** 拖入工程先预览，确认后的打开与版本检查交给常驻生命周期。 */
export function AgentProjectOpenDialog(props: { path: string; on_close: () => void }): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  const { project_snapshot } = useDesktopState();
  const preview = useProjectPreview(props.path);
  const error = preview.status === "failed" ? preview.error : undefined;
  // 语言切换只更新通知文案，不重复报告同一次预览失败。
  const report_error = useEffectEvent((error: unknown) =>
    push_error_toast(t("app.feedback.load_failed"), error),
  );
  useEffect(() => {
    if (error !== undefined) report_error(error);
  }, [error]);
  const can_open = preview.status === "ready" && !lifecycle.busy && !project_snapshot.loaded;
  return (
    <AppActionDialog
      open
      contentClassName="project-lifecycle"
      description={
        <>
          <span>{t("project.open.title")}</span>
          <p className="break-all">{props.path}</p>
        </>
      }
      details={
        preview.status === "ready" ? (
          <ProjectPreviewSummary preview={preview.preview} />
        ) : preview.status === "failed" ? (
          <p>{t("app.feedback.load_failed")}</p>
        ) : (
          <Spinner />
        )
      }
      primaryAction={{
        label: t("app.action.confirm"),
        disabled: !can_open,
        onSelect: () => {
          props.on_close(); // 先结束预览确认，再交给常驻流程处理版本确认。
          lifecycle.request_open(props.path);
        },
      }}
      onClose={props.on_close}
    />
  );
}
