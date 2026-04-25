import { useI18n, type LocaleKey } from "@/i18n";
import { useActionShortcut } from "@/hooks/use-action-shortcut";
import type { TextPreservePresetInputState } from "@/pages/text-preserve-page/types";
import { Button } from "@/shadcn/button";
import { Input } from "@/shadcn/input";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";
import { ShortcutKbd } from "@/widgets/shortcut-kbd/shortcut-kbd";

type TextPreservePresetInputDialogProps = {
  state: TextPreservePresetInputState;
  on_change: (next_value: string) => void;
  on_submit: () => void;
  on_close: () => void;
};

type PresetDialogCopy = {
  title_key: LocaleKey;
  confirm_key: LocaleKey;
};

const PRESET_DIALOG_COPY_BY_MODE: Record<
  NonNullable<TextPreservePresetInputState["mode"]>,
  PresetDialogCopy
> = {
  save: {
    title_key: "text_preserve_page.preset.dialog.save_title",
    confirm_key: "text_preserve_page.preset.dialog.save_confirm",
  },
  rename: {
    title_key: "text_preserve_page.preset.dialog.rename_title",
    confirm_key: "text_preserve_page.preset.dialog.rename_confirm",
  },
};

export function TextPreservePresetInputDialog(
  props: TextPreservePresetInputDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const dialog_copy =
    props.state.mode === null ? null : PRESET_DIALOG_COPY_BY_MODE[props.state.mode];
  const is_save_mode = props.state.mode === "save";
  const confirm_label = dialog_copy === null ? "" : t(dialog_copy.confirm_key);

  useActionShortcut({
    action: "save",
    enabled: props.state.open && is_save_mode && !props.state.submitting,
    on_trigger: () => {
      props.on_submit();
    },
  });

  return (
    <AppPageDialog
      open={props.state.open}
      title={dialog_copy === null ? "" : t(dialog_copy.title_key)}
      size="sm"
      onClose={props.on_close}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.state.submitting}
            onClick={props.on_close}
          >
            {t("app.action.cancel")}
          </Button>
          {is_save_mode ? (
            <Button
              type="button"
              size="sm"
              disabled={props.state.submitting}
              onClick={props.on_submit}
            >
              {confirm_label}
              <ShortcutKbd
                action="save"
                className="border border-primary-foreground/16 bg-primary-foreground/18 text-primary-foreground"
              />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={props.state.submitting}
              onClick={props.on_submit}
            >
              {confirm_label}
            </Button>
          )}
        </>
      }
    >
      <Input
        autoFocus
        value={props.state.value}
        disabled={props.state.submitting}
        placeholder={t("text_preserve_page.preset.dialog.name_placeholder")}
        onChange={(event) => {
          props.on_change(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.on_submit();
          }
        }}
      />
    </AppPageDialog>
  );
}
