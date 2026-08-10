import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { Input } from "@frontend/shadcn/input";
import { AppButton } from "@frontend/widgets/app-button";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

import type { PresetInputState } from "./preset-types";

type PresetNameDialogProps = {
  state: PresetInputState;
  name_placeholder_key?: LocaleKey;
  save_shortcut_variant?: "default" | "outlined";
  on_change: (next_value: string) => void;
  on_submit: () => void;
  on_close: () => void;
};

const COPY_BY_MODE: Record<NonNullable<PresetInputState["mode"]>, { confirm_key: LocaleKey }> = {
  save: {
    confirm_key: "app.action.save",
  },
  rename: {
    confirm_key: "preset_editor.action.rename",
  },
};

/**
 * 统一预设保存/重命名输入框；提交结果与关闭时机由页面状态 Hook 决定。
 */
export function PresetNameDialog(props: PresetNameDialogProps): JSX.Element {
  const { t } = useI18n();
  const dialog_copy = props.state.mode === null ? null : COPY_BY_MODE[props.state.mode];
  const is_save_mode = props.state.mode === "save";
  const confirm_label = dialog_copy === null ? "" : t(dialog_copy.confirm_key);

  useActionShortcut({
    action: "save",
    enabled: props.state.open && is_save_mode && !props.state.submitting,
    on_trigger: props.on_submit,
  });

  return (
    <AppPageDialog
      open={props.state.open}
      title={confirm_label}
      size="sm"
      onClose={props.on_close}
      footer={
        <>
          <AppButton
            type="button"
            variant="outline"
            size="sm"
            disabled={props.state.submitting}
            onClick={props.on_close}
          >
            {t("app.action.cancel")}
          </AppButton>
          <AppButton
            type="button"
            size="sm"
            disabled={props.state.submitting}
            onClick={props.on_submit}
          >
            {confirm_label}
            {is_save_mode ? (
              <ShortcutKbd
                action="save"
                className={
                  props.save_shortcut_variant === "outlined"
                    ? "border border-primary-foreground/16 bg-primary-foreground/18 text-primary-foreground"
                    : "bg-background/18 text-primary-foreground"
                }
              />
            ) : null}
          </AppButton>
        </>
      }
    >
      <Input
        autoFocus
        value={props.state.value}
        disabled={props.state.submitting}
        placeholder={t(props.name_placeholder_key ?? "preset_editor.dialog.name_placeholder")}
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
