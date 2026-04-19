import { useI18n } from "@/i18n";
import type { ProofreadingPendingMutation } from "@/pages/proofreading-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type ProofreadingConfirmDialogProps = {
  state: ProofreadingPendingMutation | null;
  on_confirm: () => Promise<void>;
  on_close: () => void;
};

export function ProofreadingConfirmDialog(
  props: ProofreadingConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const selection_count = props.state?.target_row_ids.length ?? 0;
  const is_retranslate = props.state?.kind === "retranslate-items";
  const title = is_retranslate
    ? t("proofreading_page.confirm.retranslate_title")
    : t("proofreading_page.confirm.reset_title");
  const description = is_retranslate
    ? t("proofreading_page.confirm.retranslate_description").replace(
        "{COUNT}",
        selection_count.toString(),
      )
    : t("proofreading_page.confirm.reset_description").replace(
        "{COUNT}",
        selection_count.toString(),
      );

  return (
    <AppAlertDialog
      open={props.state !== null}
      title={title}
      description={description}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
