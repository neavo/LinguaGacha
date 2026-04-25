import { useI18n, type LocaleKey } from "@/i18n";
import type { TextReplacementConfirmState } from "@/pages/text-replacement-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type TextReplacementConfirmDialogProps = {
  state: TextReplacementConfirmState;
  on_confirm: () => void;
  on_close: () => void;
};

type ConfirmCopy = {
  description_key: LocaleKey;
};

const CONFIRM_COPY_BY_KIND: Record<
  NonNullable<TextReplacementConfirmState["kind"]>,
  ConfirmCopy
> = {
  "delete-selection": {
    description_key: "text_replacement_page.confirm.delete_selection.description",
  },
  "delete-preset": {
    description_key: "text_replacement_page.confirm.delete_preset.description",
  },
  reset: {
    description_key: "text_replacement_page.confirm.reset.description",
  },
  "overwrite-preset": {
    description_key: "text_replacement_page.confirm.overwrite_preset.description",
  },
};

export function TextReplacementConfirmDialog(
  props: TextReplacementConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const dialog_copy = props.state.kind === null ? null : CONFIRM_COPY_BY_KIND[props.state.kind];
  const description =
    dialog_copy === null
      ? ""
      : t(dialog_copy.description_key)
          .replace("{COUNT}", props.state.selection_count.toString())
          .replace("{NAME}", props.state.preset_name);

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
