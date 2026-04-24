import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";
import { useI18n } from "@/i18n";
import type { NameFieldConfirmState } from "@/pages/name-field-extraction-page/types";

type NameFieldExtractionConfirmDialogProps = {
  state: NameFieldConfirmState;
  on_confirm: () => void | Promise<void>;
  on_close: () => void;
};

export function NameFieldExtractionConfirmDialog(
  props: NameFieldExtractionConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const title = t("name_field_extraction_page.confirm.delete_selection.title");
  const description = t("name_field_extraction_page.confirm.delete_selection.description").replace(
    "{COUNT}",
    props.state.selection_count.toString(),
  );

  return (
    <AppAlertDialog
      open={props.state.open}
      title={title}
      description={description}
      submitting={props.state.submitting}
      confirmVariant="destructive"
      confirmLabel={t("app.action.confirm")}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
