import { useState, type JSX } from "react";
import type { ProjectPrefilterSettingKey } from "@domain/project-settings";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_saved_toast } from "@frontend/app/feedback/project-settings-feedback";
import { useI18n } from "@frontend/app/locale/locale-context";
import { render_rich_text, type RichTextComponentMap } from "@frontend/app/locale/rich-text";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import { is_project_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";

type ProjectPrefilterSettingDialogProps = {
  projectId: string;
  field: ProjectPrefilterSettingKey;
  enabled: boolean;
  onClose: () => void;
};

const DESCRIPTION_COMPONENT_MAP: RichTextComponentMap = {
  emphasis: (children) => (
    <span className="project-prefilter-dialog__emphasis font-medium">{children}</span>
  ),
};

/** 工程预过滤开关确认框：以三按钮表达取消、禁用与启用，并受当前工程运行占用约束。 */
export function ProjectPrefilterSettingDialog({
  projectId,
  field,
  enabled,
  onClose,
}: ProjectPrefilterSettingDialogProps): JSX.Element {
  const { t } = useI18n();
  const api_fetch = useProjectFetch();
  const { commit_project_write } = useDesktopState();
  const runtime = useRuntimeSnapshot();
  const [submitting_action, set_submitting_action] = useState<"primary" | "secondary" | null>(null);
  const runtime_locked = is_project_busy(runtime.projects?.[projectId]);
  const description = t(`app.project_prefilter.${field}.description`);

  /** 提交同值只关闭确认框，实际改动经工程写入口保存并回读。 */
  async function handle_submit(next_enabled: boolean): Promise<void> {
    if (submitting_action !== null || runtime_locked) return;
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
      submitting={submitting_action !== null}
      {...(submitting_action === null ? {} : { submittingAction: submitting_action })}
      secondaryAction={{
        label: t("app.toggle.option.disabled"),
        disabled: runtime_locked,
        onSelect: () => handle_submit(false),
      }}
      primaryAction={{
        label: t("app.toggle.option.enabled"),
        disabled: runtime_locked,
        onSelect: () => handle_submit(true),
      }}
      onClose={onClose}
    />
  );
}
