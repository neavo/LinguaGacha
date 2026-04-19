import { useI18n, type LocaleKey } from "@/i18n";
import type { GlossaryConfirmState } from "@/pages/glossary-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type GlossaryConfirmDialogProps = {
  state: GlossaryConfirmState;
  on_confirm: () => void;
  on_close: () => void;
};

type ConfirmCopy = {
  title_key: LocaleKey;
  description_key: LocaleKey;
};

const CONFIRM_COPY_BY_KIND: Record<
  NonNullable<GlossaryConfirmState["kind"]>,
  ConfirmCopy
> = {
  "delete-selection": {
    title_key: "glossary_page.confirm.delete_selection.title",
    description_key: "glossary_page.confirm.delete_selection.description",
  },
  "delete-preset": {
    title_key: "glossary_page.confirm.delete_preset.title",
    description_key: "glossary_page.confirm.delete_preset.description",
  },
  reset: {
    title_key: "glossary_page.confirm.reset.title",
    description_key: "glossary_page.confirm.reset.description",
  },
  "overwrite-preset": {
    title_key: "glossary_page.confirm.overwrite_preset.title",
    description_key: "glossary_page.confirm.overwrite_preset.description",
  },
};

export function GlossaryConfirmDialog(
  props: GlossaryConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const dialog_copy =
    props.state.kind === null ? null : CONFIRM_COPY_BY_KIND[props.state.kind];
  const description =
    dialog_copy === null
      ? ""
      : t(dialog_copy.description_key)
          .replace("{COUNT}", props.state.selection_count.toString())
          .replace("{NAME}", props.state.preset_name);

  return (
    <AppAlertDialog
      open={props.state.open}
      title={dialog_copy === null ? "" : t(dialog_copy.title_key)}
      description={description}
      submitting={props.state.submitting}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
