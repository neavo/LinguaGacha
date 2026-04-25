export type ShortcutAction = "save" | "create" | "delete";

export type ShortcutPlatform = "mac" | "default";

type NavigatorLike = {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
};

type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey" | "target"
>;

const SHORTCUT_LABELS = {
  mac: {
    save: "⌘S",
    create: "⌘N",
    delete: "⌘⌫",
  },
  default: {
    save: "Ctrl+S",
    create: "Ctrl+N",
    delete: "Del",
  },
} satisfies Record<ShortcutPlatform, Record<ShortcutAction, string>>;

function get_runtime_navigator(): NavigatorLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return navigator as NavigatorLike;
}

export function resolve_shortcut_platform(
  navigator_like: NavigatorLike | undefined = get_runtime_navigator(),
): ShortcutPlatform {
  const platform_text = [
    navigator_like?.userAgentData?.platform,
    navigator_like?.platform,
    navigator_like?.userAgent,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");

  return /Mac|iPhone|iPad|iPod/i.test(platform_text) ? "mac" : "default";
}

export function get_shortcut_label(
  action: ShortcutAction,
  platform: ShortcutPlatform = resolve_shortcut_platform(),
): string {
  return SHORTCUT_LABELS[platform][action];
}

function has_plain_primary_modifier(
  event: ShortcutKeyboardEvent,
  platform: ShortcutPlatform,
): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  if (platform === "mac") {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

function is_save_or_create_shortcut_event(
  event: ShortcutKeyboardEvent,
  action: "save" | "create",
  platform: ShortcutPlatform,
): boolean {
  if (event.isComposing || !has_plain_primary_modifier(event, platform)) {
    return false;
  }

  const expected_key = action === "save" ? "s" : "n";
  return event.key.toLowerCase() === expected_key;
}

function is_delete_shortcut_event(
  event: ShortcutKeyboardEvent,
  platform: ShortcutPlatform,
): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) {
    return false;
  }

  if (platform === "mac") {
    return event.metaKey && !event.ctrlKey && event.key === "Backspace";
  }

  return !event.ctrlKey && !event.metaKey && event.key === "Delete";
}

export function is_action_shortcut_event(
  event: ShortcutKeyboardEvent,
  action: ShortcutAction,
  platform: ShortcutPlatform = resolve_shortcut_platform(),
): boolean {
  if (action === "delete") {
    return is_delete_shortcut_event(event, platform);
  }

  return is_save_or_create_shortcut_event(event, action, platform);
}

function is_element_inside_dialog(element: Element): boolean {
  return (
    element.closest("[data-slot='dialog-content']") !== null ||
    element.closest("[data-slot='alert-dialog-content']") !== null ||
    element.closest("[role='dialog']") !== null ||
    element.closest("[role='alertdialog']") !== null
  );
}

function is_element_text_editing_target(element: Element): boolean {
  if (element.closest(".cm-editor") !== null) {
    return true;
  }

  if (element.closest("[contenteditable='true']") !== null) {
    return true;
  }

  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const tag_name = element.tagName.toLowerCase();
  return tag_name === "input" || tag_name === "textarea" || tag_name === "select";
}

export function should_ignore_action_shortcut_event(
  event: ShortcutKeyboardEvent,
  action: ShortcutAction,
): boolean {
  if (action === "save") {
    return false;
  }

  if (!(event.target instanceof Element)) {
    return false;
  }

  return is_element_text_editing_target(event.target) || is_element_inside_dialog(event.target);
}
