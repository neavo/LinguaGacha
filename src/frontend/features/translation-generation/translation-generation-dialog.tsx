import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import type {
  TranslationGenerationFlow,
  TranslationGenerationState,
} from "@frontend/features/translation-generation/use-translation-generation-flow";
import { AppActionDialog, AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";

type TranslationGenerationDialogProps = Pick<
  TranslationGenerationFlow,
  "state" | "retry_check" | "next_step" | "confirm_generation" | "jump_to_agent" | "close"
>;

/** 提交中继续展示提交前内容，避免弹窗在译文生成受理后跳版。 */
function resolve_visible_state(
  state: TranslationGenerationState,
): Exclude<TranslationGenerationState, { phase: "closed" | "generating" }> | null {
  if (state.phase === "closed") {
    return null;
  }
  return state.phase === "generating" ? state.previous : state;
}

/** 警告与文件范围分别确认，同时命中时先处理警告。 */
export function TranslationGenerationDialog(
  props: TranslationGenerationDialogProps,
): JSX.Element | null {
  const { t } = useI18n();
  const visible_state = resolve_visible_state(props.state);
  const submitting = props.state.phase === "generating";

  if (visible_state === null) {
    return null;
  }

  if (visible_state.phase === "checking") {
    return (
      <AppActionDialog
        open
        description={t("app.translation_generation.confirmation.checking")}
        primaryAction={{
          label: t("app.action.confirm"),
          onSelect: props.confirm_generation,
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
        description={t("app.translation_generation.confirmation.check_failed")}
        submitting={submitting}
        primaryAction={{
          label: t("app.translation_generation.confirmation.retry_check"),
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
        description={t("app.translation_generation.confirmation.warning_description", {
          COUNT: String(visible_state.warning_count),
        })}
        submitting={submitting}
        primaryAction={{
          label: t(
            has_next
              ? "app.action.next"
              : "app.translation_generation.confirmation.generate_directly",
          ),
          onSelect: has_next ? props.next_step : props.confirm_generation,
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
      <AppConfirmDialog
        open
        description={t("app.translation_generation.confirmation.description")}
        submitting={submitting}
        onConfirm={props.confirm_generation}
        onClose={props.close}
      />
    );
  }

  return (
    <AppActionDialog
      key="files"
      open
      description={t("app.translation_generation.confirmation.generic_description")}
      submitting={submitting}
      submittingAction="secondary"
      primaryAction={{
        label: t("app.action.handle_with_agent"),
        onSelect: props.jump_to_agent,
      }}
      secondaryAction={
        visible_state.has_supported_files
          ? {
              label: t("app.translation_generation.confirmation.generate_directly"),
              onSelect: props.confirm_generation,
            }
          : undefined
      }
      onClose={props.close}
    />
  );
}
