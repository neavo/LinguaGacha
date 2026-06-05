import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type { GlossaryConfirmState } from "@frontend/pages/glossary-page/types";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";

type GlossaryConfirmDialogProps = {
  state: GlossaryConfirmState;
  on_confirm: () => void;
  on_close: () => void;
};

type ConfirmCopy = {
  description_key: LocaleKey;
};

const CONFIRM_COPY_BY_KIND: Record<NonNullable<GlossaryConfirmState["kind"]>, ConfirmCopy> = {
  "delete-selection": {
    description_key: "glossary_page.confirm.delete_selection.description",
  },
  "delete-preset": {
    description_key: "glossary_page.confirm.delete_preset.description",
  },
  reset: {
    description_key: "glossary_page.confirm.reset.description",
  },
  "overwrite-preset": {
    description_key: "glossary_page.confirm.overwrite_preset.description",
  },
};
export function GlossaryConfirmDialog(props: GlossaryConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const dialog_copy = props.state.kind === null ? null : CONFIRM_COPY_BY_KIND[props.state.kind];
  const description =
    dialog_copy === null
      ? ""
      : t(dialog_copy.description_key).replace("{COUNT}", props.state.selection_count.toString());

  return (
    <AppAlertDialog
      open={props.state.open}
      description={description}
      submitting={props.state.submitting}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
