import { useState, type JSX } from "react";
import { Globe2 } from "lucide-react";
import type { ProjectLanguageKey } from "@domain/project-settings";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  push_error_toast,
  push_toast,
  run_modal_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import { get_language_label_key } from "@frontend/app/locale/language-label";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { ProjectLanguageDialog } from "@frontend/features/project-language/project-language-dialog";
import { Tooltip, TooltipContent, TooltipTarget, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";

/** 底栏读取已提交的工程语言。弹窗草稿经统一写入口提交。 */
export function AgentLanguageControl(props: {
  locked: boolean;
  disconnected: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const { project_snapshot, commit_project_write, initial_state_status } = useDesktopState();
  const runtime = useRuntimeSnapshot();
  const languages = project_snapshot.loaded ? project_snapshot.languages : null;
  const [draft, set_draft] = useState<Record<ProjectLanguageKey, string> | null>(null); // 关闭弹窗即释放草稿。
  const [submitting, set_submitting] = useState(false); // 提交期间锁定选择、确认和关闭。
  const disabled =
    props.locked ||
    props.disconnected ||
    initial_state_status !== "ready" ||
    is_runtime_busy(runtime);
  // 底部交互收起或工程结束时丢弃未提交草稿，恢复输入后不重新打开旧弹窗。
  if ((props.locked || languages === null) && draft !== null && !submitting) set_draft(null);
  if (languages === null) return null;

  /** 两种语言合并提交。未修改时只关闭弹窗。 */
  const confirm = async (): Promise<void> => {
    if (disabled || submitting || draft === null) return;
    const changed_fields = {
      source_language: draft.source_language !== languages.source_language,
      target_language: draft.target_language !== languages.target_language,
    };
    if (!changed_fields.source_language && !changed_fields.target_language) {
      set_draft(null);
      return;
    }
    /** 成功后交回工程快照，失败时保留草稿供再次确认。 */
    const save = async (): Promise<void> => {
      set_submitting(true);
      try {
        await commit_project_write({
          operation: "project.settings.update",
          run: () => api_fetch<ProjectWriteResultPayload>("/api/project/settings/update", draft),
        });
        push_toast(
          "info",
          format_project_settings_aligned_toast({ settings: draft, changed_fields, t }),
        );
        set_draft(null);
      } catch (error) {
        push_error_toast(t("app.feedback.save_failed"), error);
      } finally {
        set_submitting(false);
      }
    };
    // 原文变更会重算预过滤，沿用工程写入的阻断式进度反馈。
    if (changed_fields.source_language) {
      await run_modal_progress_toast({ message: t("app.feedback.operation_running"), task: save });
    } else {
      await save();
    }
  };

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
                  set_draft({ ...languages });
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
          open
          languages={draft}
          disabled={disabled}
          submitting={submitting}
          on_change={(field, value) => set_draft({ ...draft, [field]: value })}
          on_confirm={confirm}
          on_close={() => set_draft(null)}
        />
      ) : null}
    </>
  );
}
