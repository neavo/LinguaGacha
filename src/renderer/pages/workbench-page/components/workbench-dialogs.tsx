import { useI18n, type LocaleKey } from "@/app/locale/locale-provider";
import type { WorkbenchDialogState } from "@/pages/workbench-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog";

type WorkbenchDialogsProps = {
  dialog_state: WorkbenchDialogState;
  on_confirm: () => void;
  on_secondary: () => void;
  on_cancel: () => void;
  on_close: () => void;
};

type DialogCopy = {
  description_key: LocaleKey;
  confirm_key?: LocaleKey;
  cancel_key?: LocaleKey;
  secondary_key?: LocaleKey;
};

const DIALOG_COPY_BY_KIND: Record<NonNullable<WorkbenchDialogState["kind"]>, DialogCopy> = {
  "confirm-import-files": {
    description_key: "workbench_page.dialog.import_conflict.description",
    confirm_key: "app.action.replace",
    secondary_key: "app.action.skip",
  },
  "inherit-import-files": {
    description_key: "workbench_page.dialog.inherit_import.description",
    confirm_key: "workbench_page.dialog.inherit_import.confirm",
    cancel_key: "workbench_page.dialog.inherit_import.cancel",
  },
  "reset-file": {
    description_key: "workbench_page.dialog.reset.description",
  },
  "delete-file": {
    description_key: "workbench_page.dialog.delete.description",
  },
  "generate-translation": {
    description_key: "workbench_page.dialog.generate_translation.description",
  },
  "close-project": {
    description_key: "workbench_page.dialog.close_project.description",
  },
};

/**
 * 解析当前场景的最终消费值。
 */
function resolve_dialog_copy(dialog_state: WorkbenchDialogState): DialogCopy | null {
  if (dialog_state.kind === null) {
    return null;
  } else {
    return DIALOG_COPY_BY_KIND[dialog_state.kind];
  }
}
export function WorkbenchDialogs(props: WorkbenchDialogsProps): JSX.Element {
  const { t } = useI18n();
  const dialog_copy = resolve_dialog_copy(props.dialog_state);
  const description =
    dialog_copy === null
      ? ""
      : t(dialog_copy.description_key).replace(
          "{COUNT}",
          props.dialog_state.target_rel_paths.length.toString(),
        );
  return (
    <AppAlertDialog
      open={dialog_copy !== null}
      description={description}
      submitting={props.dialog_state.submitting}
      onConfirm={props.on_confirm}
      onCancel={props.on_cancel}
      onClose={props.on_close}
      confirmLabel={dialog_copy?.confirm_key === undefined ? undefined : t(dialog_copy.confirm_key)}
      cancelLabel={dialog_copy?.cancel_key === undefined ? undefined : t(dialog_copy.cancel_key)}
      secondaryLabel={
        dialog_copy?.secondary_key === undefined ? undefined : t(dialog_copy.secondary_key)
      }
      onSecondary={dialog_copy?.secondary_key === undefined ? undefined : props.on_secondary}
    />
  );
}
