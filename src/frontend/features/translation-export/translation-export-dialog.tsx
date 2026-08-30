import { useI18n } from "@frontend/app/locale/locale-provider";
import { PROOFREADING_WARNING_LABEL_KEY_BY_CODE } from "@frontend/features/proofreading/proofreading-label-keys";
import type {
  TranslationExportFlow,
  TranslationExportState,
} from "@frontend/features/translation-export/use-translation-export-flow";
import { AppActionDialog, AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";

type TranslationExportDialogProps = Pick<
  TranslationExportFlow,
  "state" | "retry_check" | "confirm_export" | "jump_to_agent" | "close"
>;

/** 提交中继续展示提交前内容，避免弹窗在导出受理后跳版。 */
function resolve_visible_state(
  state: TranslationExportState,
): Exclude<TranslationExportState, { phase: "closed" | "exporting" }> | null {
  if (state.phase === "closed") {
    return null;
  }
  return state.phase === "exporting" ? state.previous : state;
}

/** 按预检结果呈现检查、恢复、普通确认或警告分流。 */
export function TranslationExportDialog(props: TranslationExportDialogProps): JSX.Element | null {
  const { t } = useI18n();
  const visible_state = resolve_visible_state(props.state);
  const submitting = props.state.phase === "exporting";

  if (visible_state === null) {
    return null;
  }

  if (visible_state.phase === "checking") {
    return (
      <AppActionDialog
        open
        description={t("workbench_page.translation_export.checking")}
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
        description={t("workbench_page.translation_export.check_failed")}
        submitting={submitting}
        primaryAction={{
          label: t("workbench_page.translation_export.continue_generate"),
          onSelect: props.confirm_export,
        }}
        secondaryAction={{
          label: t("workbench_page.translation_export.retry_check"),
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
        description={t("workbench_page.translation_task.confirm.generate_description")}
        submitting={submitting}
        onConfirm={props.confirm_export}
        onClose={props.close}
      />
    );
  }

  const warning_description = t("workbench_page.translation_export.warning_description", {
    COUNT: visible_state.summary.total_count.toString(),
  });
  return (
    <AppActionDialog
      open
      description={warning_description}
      details={
        <dl
          className="grid gap-1.5 rounded-md bg-muted/55 px-3 py-2 text-sm"
          aria-label={t("workbench_page.translation_export.warning_list")}
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
        label: t("app.action.continue_task"),
        onSelect: props.confirm_export,
      }}
      secondaryAction={{
        label: t("app.action.go_to_agent"),
        onSelect: props.jump_to_agent,
      }}
      onClose={props.close}
    />
  );
}
