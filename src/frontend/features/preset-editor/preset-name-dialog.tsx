import type { JSX } from "react";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { Input } from "@frontend/shadcn/input";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

import type { PresetInputState } from "./preset-types";

type PresetNameDialogProps = {
  state: PresetInputState;
  on_change: (next_value: string) => void;
  on_submit: () => void;
  on_close: () => void;
};

const CONFIRM_KEY_BY_MODE: Record<NonNullable<PresetInputState["mode"]>, LocaleKey> = {
  save: "app.action.save",
  rename: "preset_editor.action.rename",
};

/**
 * 统一预设保存与重命名输入框，提交结果与关闭时机由页面状态 Hook 决定。
 */
export function PresetNameDialog(props: PresetNameDialogProps): JSX.Element {
  const { t } = useI18n();
  const confirm_label = props.state.mode === null ? "" : t(CONFIRM_KEY_BY_MODE[props.state.mode]);

  return (
    <AppPageDialog
      open={props.state.open}
      title={confirm_label}
      size="sm"
      onClose={props.on_close}
      submitting={props.state.submitting}
      primaryAction={{ label: confirm_label, shortcut: "submit", onSelect: props.on_submit }}
    >
      <Input
        autoFocus
        value={props.state.value}
        disabled={props.state.submitting}
        placeholder={t("preset_editor.dialog.name_placeholder")}
        onChange={(event) => {
          props.on_change(event.target.value);
        }}
      />
    </AppPageDialog>
  );
}
