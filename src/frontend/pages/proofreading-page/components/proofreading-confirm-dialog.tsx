import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  type ProofreadingConfirmationAction,
  type ProofreadingPendingConfirmation,
} from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import { AppActionDialog, AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";

type ProofreadingConfirmDialogProps = {
  state: ProofreadingPendingConfirmation | null;
  on_confirm: (action: ProofreadingConfirmationAction) => Promise<void>;
  on_close: () => void;
};
export function ProofreadingConfirmDialog(props: ProofreadingConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const selection_count = props.state?.target_row_ids.length ?? 0;
  if (props.state?.kind === "clear-translations") {
    const description = t("proofreading_page.confirm.clear_translation_description").replace(
      "{COUNT}",
      selection_count.toString(),
    );
    const submitting_action = props.state.submitting_action;
    return (
      <AppActionDialog
        open
        description={description}
        submitting={submitting_action !== null}
        submittingAction={submitting_action === "clear-translations" ? "secondary" : "primary"}
        primaryAction={{
          label: t("proofreading_page.action.clear_and_reset_status"),
          onSelect: () => props.on_confirm("clear-translations-and-reset-status"),
        }}
        secondaryAction={{
          label: t("proofreading_page.action.clear_translation"),
          onSelect: () => props.on_confirm("clear-translations"),
        }}
        onClose={props.on_close}
      />
    );
  }

  const description =
    props.state?.kind === "retranslate"
      ? t("proofreading_page.confirm.retranslate_description").replace(
          "{COUNT}",
          selection_count.toString(),
        )
      : "";

  return (
    <AppConfirmDialog
      open={props.state !== null}
      description={description}
      submitting={props.state?.submitting_action === "retranslate"}
      onConfirm={() => props.on_confirm("retranslate")}
      onClose={props.on_close}
    />
  );
}
