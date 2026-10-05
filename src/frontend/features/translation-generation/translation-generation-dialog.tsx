import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { PROOFREADING_WARNING_LABEL_KEY_BY_CODE } from "@frontend/features/proofreading/proofreading-label-keys";
import type {
  TranslationGenerationFlow,
  TranslationGenerationState,
} from "@frontend/features/translation-generation/use-translation-generation-flow";
import { AppActionDialog, AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";

type TranslationGenerationDialogProps = Pick<
  TranslationGenerationFlow,
  "state" | "retry_check" | "confirm_generation" | "jump_to_agent" | "can_jump_to_agent" | "close"
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

/** 按预检结果呈现检查、恢复、普通确认或警告分流。 */
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
          label: t("app.translation_generation.confirmation.continue_generate"),
          onSelect: props.confirm_generation,
        }}
        secondaryAction={{
          label: t("app.translation_generation.confirmation.retry_check"),
          onSelect: props.retry_check,
        }}
        onClose={props.close}
      />
    );
  }

  if (visible_state.summary.total_count === 0) {
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

  const warning_description = t("app.translation_generation.confirmation.warning_description", {
    COUNT: visible_state.summary.total_count.toString(),
  });
  return (
    <AppActionDialog
      open
      description={warning_description}
      details={
        <dl
          className="grid gap-1.5 rounded-md bg-muted/55 px-3 py-2 text-sm"
          aria-label={warning_description}
        >
          {visible_state.summary.entries.map((entry) => (
            <div key={entry.code} className="flex items-center justify-between gap-6">
              <dt>{t(PROOFREADING_WARNING_LABEL_KEY_BY_CODE[entry.code])}</dt>
              <dd className="font-medium tabular-nums">{entry.count}</dd>
            </div>
          ))}
        </dl>
      }
      submitting={submitting}
      primaryAction={{
        label: t("app.translation_generation.confirmation.continue_generate"),
        onSelect: props.confirm_generation,
      }}
      secondaryAction={
        props.can_jump_to_agent
          ? {
              label: t("app.action.go_to_agent"),
              onSelect: props.jump_to_agent,
            }
          : undefined
      }
      onClose={props.close}
    />
  );
}
