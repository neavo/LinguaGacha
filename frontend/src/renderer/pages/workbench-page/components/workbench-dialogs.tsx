import { useI18n, type LocaleKey } from "@/i18n";
import type { WorkbenchDialogState } from "@/pages/workbench-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type WorkbenchDialogsProps = {
  dialog_state: WorkbenchDialogState;
  on_confirm: () => void;
  on_close: () => void;
};

type DialogCopy = {
  title_key: LocaleKey;
  description_key: LocaleKey;
};

const DIALOG_COPY_BY_KIND: Record<
  NonNullable<WorkbenchDialogState["kind"]>,
  DialogCopy
> = {
  "replace-file": {
    title_key: "workbench_page.dialog.replace.title",
    description_key: "workbench_page.dialog.replace.description",
  },
  "reset-file": {
    title_key: "workbench_page.dialog.reset.title",
    description_key: "workbench_page.dialog.reset.description",
  },
  "delete-file": {
    title_key: "workbench_page.dialog.delete.title",
    description_key: "workbench_page.dialog.delete.description",
  },
  "export-translation": {
    title_key: "workbench_page.dialog.export.title",
    description_key: "workbench_page.dialog.export.description",
  },
  "close-project": {
    title_key: "workbench_page.dialog.close_project.title",
    description_key: "workbench_page.dialog.close_project.description",
  },
};

function resolve_dialog_copy(
  dialog_state: WorkbenchDialogState,
): DialogCopy | null {
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
      title={dialog_copy === null ? "" : t(dialog_copy.title_key)}
      description={dialog_copy === null ? "" : t(dialog_copy.description_key)}
      submitting={props.dialog_state.submitting}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
