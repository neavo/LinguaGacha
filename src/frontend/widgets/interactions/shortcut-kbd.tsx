import type { JSX } from "react";
import {
  get_shortcut_label,
  type ShortcutLabel,
} from "@frontend/widgets/interactions/keyboard-shortcuts";
import { Kbd } from "@frontend/shadcn/kbd";

type ShortcutKbdProps = {
  action: ShortcutLabel;
};

/** 按钮内键帽只作视觉提示，键位由按钮的 `aria-keyshortcuts` 声明，避免混入按钮名称。 */
export function ShortcutKbd(props: ShortcutKbdProps): JSX.Element {
  return <Kbd aria-hidden="true">{get_shortcut_label(props.action)}</Kbd>;
}

type ShortcutTooltipRowProps = {
  label: string;
  shortcut: ShortcutLabel;
};

/** Tooltip 快捷键行统一分离动作与键位，并让多行键帽保持右对齐。提示文本需要读出键位，所以键帽不隐藏。 */
export function ShortcutTooltipRow(props: ShortcutTooltipRowProps): JSX.Element {
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0">{props.label}</span>
      <Kbd className="shrink-0">{get_shortcut_label(props.shortcut)}</Kbd>
    </span>
  );
}
