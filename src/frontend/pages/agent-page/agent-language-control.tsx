import { useProjectRuntimeSnapshot } from "@frontend/app/state/use-project-runtime";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import { useState, type JSX } from "react";
import { Globe2 } from "lucide-react";
import type { ProjectLanguageSettings } from "@domain/project-settings";
import {
  push_error_toast,
  push_toast,
  run_modal_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_saved_toast } from "@frontend/app/feedback/project-settings-feedback";
import { get_language_label_key } from "@frontend/app/locale/language-label";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { ProjectLanguageDialog } from "@frontend/features/project-language/project-language-dialog";
import { Tooltip, TooltipContent, TooltipTarget, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";

/** 底栏读取已提交的工程语言。弹窗草稿经统一写入口提交。 */
export function AgentLanguageControl(props: {
  locked: boolean;
  disconnected: boolean;
}): JSX.Element | null {
  const api_fetch = useProjectFetch();
  const { t } = useI18n();
  const { project_snapshot, commit_project_write, initial_state_status } = useDesktopState();
  const runtime = useProjectRuntimeSnapshot();
  const languages = project_snapshot.loaded ? project_snapshot.settings : null;
  const disabled =
    props.locked ||
    props.disconnected ||
    initial_state_status !== "ready" ||
    is_runtime_busy(runtime);
  if (languages === null) return null;

  /** 未改语言时直接关闭确认，原文变更需要等待工程重算预过滤。 */
  const save = async (draft: ProjectLanguageSettings): Promise<boolean> => {
    const changed_fields = {
      source_language: draft.source_language !== languages.source_language,
      target_language: draft.target_language !== languages.target_language,
    };
    if (!changed_fields.source_language && !changed_fields.target_language) return true;
    const write = () =>
      commit_project_write({
        operation: "project.settings.update",
        run: () => api_fetch<ProjectWriteResultPayload>("/api/project/settings/update", draft),
      });
    try {
      if (changed_fields.source_language) {
        await run_modal_progress_toast({
          message: t("app.feedback.operation_running"),
          task: write,
        });
      } else {
        await write();
      }
      push_toast(
        "info",
        format_project_settings_saved_toast(
          {
            ...(changed_fields.source_language ? { source_language: draft.source_language } : {}),
            ...(changed_fields.target_language ? { target_language: draft.target_language } : {}),
          },
          t,
        ),
      );
      return true;
    } catch (error) {
      push_error_toast(t("app.feedback.save_failed"), error);
      return false;
    }
  };

  return (
    <AgentLanguageButton
      languages={languages}
      locked={props.locked}
      disabled={disabled}
      on_confirm={save}
    />
  );
}

/** 语言按钮只持有弹窗内的编辑草稿，确认后由调用方保存语言。 */
export function AgentLanguageButton({
  languages,
  locked,
  disabled,
  on_confirm,
}: {
  languages: ProjectLanguageSettings;
  locked: boolean;
  disabled: boolean;
  on_confirm: (languages: ProjectLanguageSettings) => boolean | Promise<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const [draft, set_draft] = useState<ProjectLanguageSettings | null>(null);
  const [submitting, set_submitting] = useState(false);
  if (locked && draft !== null && !submitting) set_draft(null); // 输入暂时失去前台时，丢弃未确认的语言。

  /** 保存失败时保留本次选择，供用户在同一弹窗重试。 */
  async function confirm(): Promise<void> {
    if (disabled || submitting || draft === null) return;
    set_submitting(true);
    try {
      if (await on_confirm(draft)) set_draft(null);
    } finally {
      set_submitting(false);
    }
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <TooltipTarget>
              <AppButton
                type="button"
                size="sm"
                variant="ghost"
                className="agent-composer__language-trigger"
                disabled={disabled || submitting}
                aria-label={t("project.language.title")}
                aria-haspopup="dialog"
                onClick={() => {
                  set_draft({
                    source_language: languages.source_language,
                    target_language: languages.target_language,
                  });
                }}
              >
                <Globe2 aria-hidden="true" />
                <span>{`${t(`project.language.short.${languages.source_language}`)}->${t(`project.language.short.${languages.target_language}`)}`}</span>
              </AppButton>
            </TooltipTarget>
          }
        />
        <TooltipContent>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
            <dt>{t("app.language_role.source")}</dt>
            <dd>{t(get_language_label_key(languages.source_language))}</dd>
            <dt>{t("app.language_role.target")}</dt>
            <dd>{t(get_language_label_key(languages.target_language))}</dd>
          </dl>
        </TooltipContent>
      </Tooltip>
      {draft !== null ? (
        <ProjectLanguageDialog
          languages={draft}
          disabled={disabled}
          submitting={submitting}
          on_change={set_draft}
          on_confirm={confirm}
          on_close={() => set_draft(null)}
        />
      ) : null}
    </>
  );
}
