import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";
import { useI18n } from "@frontend/app/locale/locale-provider";
import type { NameFieldConfirmState } from "@frontend/pages/name-field-extraction-page/types";

type NameFieldExtractionConfirmDialogProps = {
  state: NameFieldConfirmState;
  on_confirm: () => void | Promise<void>;
  on_close: () => void;
};
export function NameFieldExtractionConfirmDialog(
  props: NameFieldExtractionConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const description = t("name_field_extraction_page.confirm.delete_selection.description").replace(
    "{COUNT}",
    props.state.selection_count.toString(),
  );

  return (
    <AppAlertDialog
      open={props.state.open}
      description={description}
      submitting={props.state.submitting}
      confirmVariant="destructive"
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
