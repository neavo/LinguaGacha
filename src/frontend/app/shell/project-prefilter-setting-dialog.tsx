import { useState, type JSX } from "react";
import type { ProjectPrefilterSettingKey } from "@domain/project-settings";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_saved_toast } from "@frontend/app/feedback/project-settings-feedback";
import { useI18n } from "@frontend/app/locale/locale-context";
import { render_rich_text, type RichTextComponentMap } from "@frontend/app/locale/rich-text";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";

type ProjectPrefilterSettingDialogProps = {
  field: ProjectPrefilterSettingKey;
  enabled: boolean;
  runtimeLocked: boolean;
  onClose: () => void;
};

const DESCRIPTION_COMPONENT_MAP: RichTextComponentMap = {
  emphasis: (children) => (
    <span className="project-prefilter-dialog__emphasis font-medium">{children}</span>
  ),
};

/** 在当前功能页确认预过滤设置，由工程写入口随设置变更重算条目。 */
export function ProjectPrefilterSettingDialog({
  field,
  enabled,
  runtimeLocked,
  onClose,
}: ProjectPrefilterSettingDialogProps): JSX.Element {
  const { t } = useI18n();
  const api_fetch = useProjectFetch();
  const { commit_project_write } = useDesktopState();
  const [submitting_action, set_submitting_action] = useState<"primary" | "secondary" | null>(null);
  const description = t(`app.project_prefilter.${field}.description`);

  /** 选择当前状态时直接关闭，避免为同值占用工程写入。 */
  async function handle_submit(next_enabled: boolean): Promise<void> {
    if (next_enabled === enabled) {
      onClose();
      return;
    }
    set_submitting_action(next_enabled ? "primary" : "secondary");
    try {
      await commit_project_write({
        operation: "project.settings.update",
        run: () =>
          api_fetch<ProjectWriteResultPayload>("/api/project/settings/update", {
            [field]: next_enabled,
          }),
      });
      push_toast("info", format_project_settings_saved_toast({ [field]: next_enabled }, t));
      onClose();
    } catch (error) {
      push_error_toast(t("app.feedback.save_failed"), error);
    } finally {
      set_submitting_action(null);
    }
  }

  return (
    <AppActionDialog
      open
      description={render_rich_text(description, DESCRIPTION_COMPONENT_MAP)}
      {...(submitting_action === null
        ? {}
        : { submitting: true, submittingAction: submitting_action })}
      secondaryAction={{
        label: t("app.toggle.option.disabled"),
        disabled: runtimeLocked,
        onSelect: () => handle_submit(false),
      }}
      primaryAction={{
        label: t("app.toggle.option.enabled"),
        disabled: runtimeLocked,
        onSelect: () => handle_submit(true),
      }}
      onClose={onClose}
    />
  );
}
