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
