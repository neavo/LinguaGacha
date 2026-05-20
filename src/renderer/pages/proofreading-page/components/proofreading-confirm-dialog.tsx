import { useI18n } from "@/app/locale/locale-provider";
import {
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  type ProofreadingPendingMutation,
} from "@/pages/proofreading-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type ProofreadingConfirmDialogProps = {
  state: ProofreadingPendingMutation | null;
  on_confirm: () => Promise<void>;
  on_close: () => void;
};

export function ProofreadingConfirmDialog(props: ProofreadingConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const selection_count = props.state?.target_row_ids.length ?? 0;
  let description = "";

  if (props.state?.kind === "retranslate") {
    description = t("proofreading_page.confirm.retranslate_description").replace(
      "{COUNT}",
      selection_count.toString(),
    );
  } else if (props.state?.kind === "clear-translations") {
    description = t("proofreading_page.confirm.clear_translation_description").replace(
      "{COUNT}",
      selection_count.toString(),
    );
  } else if (props.state?.kind === "set-status") {
    const status_label = t(PROOFREADING_STATUS_LABEL_KEY_BY_CODE[props.state.status]);
    description = t("proofreading_page.confirm.set_status_description")
      .replace("{COUNT}", selection_count.toString())
      .replace("{STATUS}", status_label);
  }

  return (
    <AppAlertDialog
      open={props.state !== null}
      description={description}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
