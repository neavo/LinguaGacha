import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type { CustomPromptConfirmState } from "@frontend/pages/custom-prompt-page/types";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";

type CustomPromptConfirmDialogProps = {
  state: CustomPromptConfirmState;
  on_confirm: () => void;
  on_close: () => void;
};

type ConfirmCopy = {
  description_key: LocaleKey;
  confirm_key?: LocaleKey;
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
  "enable-after-import": {
    description_key: "custom_prompt_page.confirm.enable_after_import.description",
    confirm_key: "app.toggle.enabled",
  },
};
export function CustomPromptConfirmDialog(props: CustomPromptConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const dialog_copy = props.state.kind === null ? null : CONFIRM_COPY_BY_KIND[props.state.kind];
  const description = dialog_copy === null ? "" : t(dialog_copy.description_key);

  return (
    <AppAlertDialog
      open={props.state.kind !== null}
      description={description}
      submitting={props.state.kind === null ? false : props.state.submitting}
      confirmLabel={dialog_copy?.confirm_key === undefined ? undefined : t(dialog_copy.confirm_key)}
      cancelLabel={t("app.action.cancel")}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
