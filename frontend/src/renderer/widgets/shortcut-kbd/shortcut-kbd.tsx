import { get_shortcut_label, type ShortcutAction } from "@/lib/keyboard-shortcuts";
import { Kbd } from "@/shadcn/kbd";

type ShortcutKbdProps = {
  action: ShortcutAction;
  className?: string;
};

export function ShortcutKbd(props: ShortcutKbdProps): JSX.Element {
  return <Kbd className={props.className}>{get_shortcut_label(props.action)}</Kbd>;
}
