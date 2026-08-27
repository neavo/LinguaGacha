import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type { WorkbenchDialogState } from "@frontend/pages/workbench-page/types";
import { AppActionDialog, AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";

type WorkbenchDialogsProps = {
  dialog_state: WorkbenchDialogState;
  on_confirm: () => void;
  on_secondary: () => void;
  on_close: () => void;
};

const CONFIRM_DESCRIPTION_KEY_BY_KIND = {
  "reset-file": "workbench_page.dialog.reset.description",
  "delete-file": "workbench_page.dialog.delete.description",
  "generate-translation": "workbench_page.translation_task.confirm.generate_description",
  "close-project": "workbench_page.dialog.close_project.description",
} as const satisfies Partial<Record<NonNullable<WorkbenchDialogState["kind"]>, LocaleKey>>;

export function WorkbenchDialogs(props: WorkbenchDialogsProps): JSX.Element {
  const { t } = useI18n();
  const kind = props.dialog_state.kind;
  const count = props.dialog_state.target_rel_paths.length.toString();

  if (kind === "confirm-import-files") {
    return (
      <AppActionDialog
        open
        description={t("workbench_page.dialog.import_conflict.description").replace(
          "{COUNT}",
          count,
        )}
        submitting={props.dialog_state.submitting}
        primaryAction={{
          label: t("app.action.replace"),
          onSelect: props.on_confirm,
          destructive: true,
        }}
        secondaryAction={{ label: t("app.action.skip"), onSelect: props.on_secondary }}
        onClose={props.on_close}
      />
    );
  }

  if (kind === "inherit-import-files") {
    return (
      <AppActionDialog
        open
        description={t("workbench_page.dialog.inherit_import.description")}
        submitting={props.dialog_state.submitting}
        primaryAction={{
          label: t("workbench_page.dialog.inherit_import.fill"),
          onSelect: props.on_confirm,
        }}
        secondaryAction={{
          label: t("workbench_page.dialog.inherit_import.do_not_fill"),
          onSelect: props.on_secondary,
        }}
        dismissAction={null}
        onClose={props.on_close}
      />
    );
  }

  const description_key = kind === null ? null : CONFIRM_DESCRIPTION_KEY_BY_KIND[kind];
  return (
    <AppConfirmDialog
      open={description_key !== null && description_key !== undefined}
      description={description_key === null ? "" : t(description_key).replace("{COUNT}", count)}
      submitting={props.dialog_state.submitting}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
