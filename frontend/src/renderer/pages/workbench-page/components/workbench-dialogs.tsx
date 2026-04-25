import { useI18n, type LocaleKey } from "@/i18n";
import type { WorkbenchDialogState } from "@/pages/workbench-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type WorkbenchDialogsProps = {
  dialog_state: WorkbenchDialogState;
  on_confirm: () => void;
  on_cancel: () => void;
  on_close: () => void;
};

type DialogCopy = {
  description_key: LocaleKey;
  confirm_key?: LocaleKey;
  cancel_key?: LocaleKey;
};

const DIALOG_COPY_BY_KIND: Record<NonNullable<WorkbenchDialogState["kind"]>, DialogCopy> = {
  "inherit-add-file": {
    description_key: "workbench_page.dialog.inherit_add.description",
    confirm_key: "workbench_page.dialog.inherit_add.confirm",
    cancel_key: "workbench_page.dialog.inherit_add.cancel",
  },
  "reset-file": {
    description_key: "workbench_page.dialog.reset.description",
  },
  "delete-file": {
    description_key: "workbench_page.dialog.delete.description",
  },
  "export-translation": {
    description_key: "workbench_page.dialog.export.description",
  },
  "close-project": {
    description_key: "workbench_page.dialog.close_project.description",
  },
};

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
  return (
    <AppAlertDialog
      open={dialog_copy !== null}
      description={dialog_copy === null ? "" : t(dialog_copy.description_key)}
      submitting={props.dialog_state.submitting}
      onConfirm={props.on_confirm}
      onCancel={props.on_cancel}
      onClose={props.on_close}
      confirmLabel={dialog_copy?.confirm_key === undefined ? undefined : t(dialog_copy.confirm_key)}
      cancelLabel={dialog_copy?.cancel_key === undefined ? undefined : t(dialog_copy.cancel_key)}
    />
  );
}
