import { useEffect, useEffectEvent } from "react";

import {
  is_action_shortcut_event,
  should_ignore_action_shortcut_event,
  type ShortcutAction,
} from "@frontend/widgets/interactions/keyboard-shortcuts";

type UseActionShortcutOptions = {
  action: ShortcutAction;
  enabled: boolean;
  /** 仅放宽普通文本编辑目标，Dialog 仍由共享快捷键过滤器隔离。 */
  allow_in_text_editing?: boolean;
  on_trigger: () => void | Promise<void>;
};

/** 注册页面级动作快捷键，并统一应用启用态与交互目标隔离规则。 */
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
        !should_ignore_action_shortcut_event(event, options.action, options.allow_in_text_editing)
      ) {
        event.preventDefault();
        handle_action_shortcut();
      }
    };

    window.addEventListener("keydown", handle_keydown, true);

    return () => {
      window.removeEventListener("keydown", handle_keydown, true);
    };
  }, [options.action, options.allow_in_text_editing, options.enabled]);
}
