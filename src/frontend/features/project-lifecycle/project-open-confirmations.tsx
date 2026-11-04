import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { render_rich_text } from "@frontend/app/locale/rich-text";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import type { useProjectOpenFlow } from "./use-project-open-flow";
import "./project-lifecycle.css";

/** 文件选择与最近工程共用版本和缺失确认，由常驻流程持有。 */
export function ProjectOpenConfirmations(props: {
  flow: ReturnType<typeof useProjectOpenFlow>;
}): JSX.Element {
  const { t } = useI18n();
  const flow = props.flow;
  return (
    <>
      <AppConfirmDialog
        open={flow.pending_confirmation !== null}
        confirmDelay
        description={
          flow.pending_confirmation === null
            ? ""
            : render_rich_text(
                t("project.open.newer_app_version_description", {
                  VERSION: flow.pending_confirmation.target_app_version,
                }),
                {
                  emphasis: (children) => (
                    <span className="project-lifecycle__version-emphasis font-medium">
                      {children}
                    </span>
                  ),
                },
              )
        }
        submitting={flow.is_opening_project}
        onConfirm={flow.confirm_open}
        onClose={flow.cancel_confirmation}
      />
      <AppConfirmDialog
        open={flow.missing_recent_project !== null}
        description={t("project.open.missing_file_description")}
        onConfirm={async () => {
          if (flow.missing_recent_project !== null)
            await flow.handle_recent_project_remove(flow.missing_recent_project.path);
        }}
        onClose={flow.close_missing_recent}
      />
    </>
  );
}
