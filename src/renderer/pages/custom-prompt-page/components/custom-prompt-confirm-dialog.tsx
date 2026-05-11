import { useI18n, type LocaleKey } from "@/i18n";
import type { CustomPromptConfirmState } from "@/pages/custom-prompt-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type CustomPromptConfirmDialogProps = {
  state: CustomPromptConfirmState;
  on_confirm: () => void;
  on_close: () => void;
};

type ConfirmCopy = {
  description_key: LocaleKey;
};

const CONFIRM_COPY_BY_KIND: Record<NonNullable<CustomPromptConfirmState["kind"]>, ConfirmCopy> = {
  reset: {
    description_key: "custom_prompt_page.confirm.reset.description",
  },
  "delete-preset": {
    description_key: "custom_prompt_page.confirm.delete_preset.description",
  },
  "overwrite-preset": {
    description_key: "custom_prompt_page.confirm.overwrite_preset.description",
  },
};

export function CustomPromptConfirmDialog(props: CustomPromptConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const dialog_copy = props.state.kind === null ? null : CONFIRM_COPY_BY_KIND[props.state.kind];
  const description =
    dialog_copy === null
      ? ""
      : t(dialog_copy.description_key).replace("{NAME}", props.state.preset_name);

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
