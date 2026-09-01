import {
  get_shortcut_label,
  type ShortcutLabel,
} from "@frontend/widgets/interactions/keyboard-shortcuts";
import { Kbd } from "@frontend/shadcn/kbd";

type ShortcutKbdProps = {
  action: ShortcutLabel;
  className?: string;
};

export function ShortcutKbd(props: ShortcutKbdProps): JSX.Element {
  return <Kbd className={props.className}>{get_shortcut_label(props.action)}</Kbd>;
}

type ShortcutTooltipRowProps = {
  label: string;
  shortcut: ShortcutLabel;
};

/** Tooltip 快捷键行统一分离动作与键位，并让多行键帽保持右对齐。 */
export function ShortcutTooltipRow(props: ShortcutTooltipRowProps): JSX.Element {
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0">{props.label}</span>
      <ShortcutKbd action={props.shortcut} className="shrink-0" />
    </span>
  );
}
