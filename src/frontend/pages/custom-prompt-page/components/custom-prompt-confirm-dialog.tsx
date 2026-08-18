import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type { CustomPromptConfirmState } from "@frontend/pages/custom-prompt-page/types";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";

type CustomPromptConfirmDialogProps = {
  state: CustomPromptConfirmState;
  on_confirm: () => void;
  on_close: () => void;
};

const CONFIRM_DESCRIPTION_KEY_BY_KIND: Record<
  NonNullable<CustomPromptConfirmState["kind"]>,
  LocaleKey
> = {
  reset: "custom_prompt_page.confirm.reset.description",
  "delete-preset": "preset_editor.confirm.delete.description",
  "overwrite-preset": "preset_editor.confirm.overwrite.description",
};
export function CustomPromptConfirmDialog(props: CustomPromptConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const description_key =
    props.state.kind === null ? null : CONFIRM_DESCRIPTION_KEY_BY_KIND[props.state.kind];
  const description = description_key === null ? "" : t(description_key);

  return (
    <AppConfirmDialog
      open={props.state.kind !== null}
      description={description}
      submitting={props.state.kind === null ? false : props.state.submitting}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
