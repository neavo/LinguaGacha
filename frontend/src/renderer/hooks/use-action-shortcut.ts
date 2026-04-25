import { useEffect, useEffectEvent } from "react";

import {
  is_action_shortcut_event,
  should_ignore_action_shortcut_event,
  type ShortcutAction,
} from "@/lib/keyboard-shortcuts";

type UseActionShortcutOptions = {
  action: ShortcutAction;
  enabled: boolean;
  on_trigger: () => void | Promise<void>;
};

export function useActionShortcut(options: UseActionShortcutOptions): void {
  const handle_action_shortcut = useEffectEvent((): void => {
    void options.on_trigger();
  });

  useEffect(() => {
    if (!options.enabled) {
      return undefined;
    }

    const handle_keydown = (event: KeyboardEvent): void => {
      if (
        is_action_shortcut_event(event, options.action) &&
        !should_ignore_action_shortcut_event(event, options.action)
      ) {
        event.preventDefault();
        handle_action_shortcut();
      }
    };

    window.addEventListener("keydown", handle_keydown, true);

    return () => {
      window.removeEventListener("keydown", handle_keydown, true);
    };
  }, [options.action, options.enabled]);
}
