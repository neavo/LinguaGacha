import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { TranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";

type TranslationExportDialogProps = Pick<
  TranslationExportFlow,
  "state" | "retry_check" | "next_step" | "confirm_export" | "jump_to_agent" | "close"
>;

/** 警告与文件范围分别确认，同时命中时先处理警告。 */
export function TranslationExportDialog(props: TranslationExportDialogProps): JSX.Element | null {
  const { t } = useI18n();
  if (props.state.phase === "closed") return null;
  const submitting = props.state.phase === "exporting";
  // 提交中沿用确认内容，避免弹窗跳版。
  const visible_state = props.state.phase === "exporting" ? props.state.previous : props.state;

  if (visible_state.phase === "checking") {
    return (
      <AppActionDialog
        open
        description={t("app.translation_export.confirmation.checking")}
        primaryAction={{
          label: t("app.action.confirm"),
          onSelect: props.confirm_export,
          disabled: true,
        }}
        onClose={props.close}
      />
    );
  }

  if (visible_state.phase === "check-failed") {
    return (
      <AppActionDialog
        open
        description={t("app.translation_export.confirmation.check_failed")}
        submitting={submitting}
        primaryAction={{
          label: t("app.translation_export.confirmation.retry_check"),
          onSelect: props.retry_check,
        }}
        secondaryAction={{
          label: t("app.action.handle_with_agent"),
          onSelect: props.jump_to_agent,
        }}
        onClose={props.close}
      />
    );
  }

  if (visible_state.step === "warnings") {
    const has_next = visible_state.has_agent_files;
    return (
      <AppActionDialog
        key="warnings"
        open
        description={t("app.translation_export.confirmation.warning_description", {
          COUNT: String(visible_state.warning_count),
        })}
        submitting={submitting}
        primaryAction={{
          label: t(
            has_next ? "app.action.next" : "app.translation_export.confirmation.export_directly",
          ),
          onSelect: has_next ? props.next_step : props.confirm_export,
        }}
        secondaryAction={{
          label: t("app.action.handle_with_agent"),
          onSelect: props.jump_to_agent,
        }}
        onClose={props.close}
      />
    );
  }

  if (!visible_state.has_agent_files) {
    return (
      <AppActionDialog
        open
        description={t("app.translation_export.confirmation.description")}
        submitting={submitting}
        primaryAction={{
          label: t("app.action.confirm"),
          onSelect: props.confirm_export,
        }}
        onClose={props.close}
      />
    );
  }

  return (
    <AppActionDialog
      key="files"
      open
      description={t("app.translation_export.confirmation.generic_description")}
      submitting={submitting}
      submittingAction="secondary"
      primaryAction={{
        label: t("app.action.handle_with_agent"),
        onSelect: props.jump_to_agent,
      }}
      secondaryAction={
        visible_state.has_supported_files
          ? {
              label: t("app.translation_export.confirmation.export_supported"),
              onSelect: props.confirm_export,
            }
          : undefined
      }
      onClose={props.close}
    />
  );
}
