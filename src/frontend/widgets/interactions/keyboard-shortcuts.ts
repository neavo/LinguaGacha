export type ShortcutAction = "save" | "create" | "delete" | "follow_latest" | "toggle_sidebar";
export type ShortcutLabel = ShortcutAction | "cancel" | "submit" | "newline";

export type ShortcutPlatform = "mac" | "default";
/** 多行输入弹窗用保存键提交，其余弹窗用回车提交。 */
export type DialogShortcut = "save" | "submit";
type PrimaryShortcutAction = Exclude<ShortcutAction, "delete">;

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
    follow_latest: "⌘E",
    toggle_sidebar: "⌘B",
    cancel: "Esc",
    submit: "Enter",
    newline: "Shift+Enter",
  },
  default: {
    save: "Ctrl+S",
    create: "Ctrl+N",
    delete: "Del",
    follow_latest: "Ctrl+E",
    toggle_sidebar: "Ctrl+B",
    cancel: "Esc",
    submit: "Enter",
    newline: "Shift+Enter",
  },
} satisfies Record<ShortcutPlatform, Record<ShortcutLabel, string>>;

/** `aria-keyshortcuts` 使用 UI Events 标准键名，与键帽的平台符号分开维护。 */
const SHORTCUT_ARIA_KEYS = {
  mac: {
    save: "Meta+S",
    create: "Meta+N",
    delete: "Meta+Backspace",
    follow_latest: "Meta+E",
    toggle_sidebar: "Meta+B",
    cancel: "Escape",
    submit: "Enter",
    newline: "Shift+Enter",
  },
  default: {
    save: "Control+S",
    create: "Control+N",
    delete: "Delete",
    follow_latest: "Control+E",
    toggle_sidebar: "Control+B",
    cancel: "Escape",
    submit: "Enter",
    newline: "Shift+Enter",
  },
} satisfies Record<ShortcutPlatform, Record<ShortcutLabel, string>>;

/** 非删除动作统一使用平台主修饰键与单字符键。 */
const PRIMARY_SHORTCUT_KEYS = {
  save: "s",
  create: "n",
  follow_latest: "e",
  toggle_sidebar: "b",
} satisfies Record<PrimaryShortcutAction, string>;

/** 为快捷键平台识别提供浏览器环境信息。 */
function get_runtime_navigator(): NavigatorLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return navigator as NavigatorLike;
}

/** 将宿主平台归并为快捷键使用的两类修饰键。 */
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

/** 为提示与菜单提供统一的平台键帽文案。 */
export function get_shortcut_label(
  action: ShortcutLabel,
  platform: ShortcutPlatform = resolve_shortcut_platform(),
): string {
  return SHORTCUT_LABELS[platform][action];
}

/** 为 `aria-keyshortcuts` 提供与键帽同源的标准键名。 */
export function get_shortcut_aria_keys(
  action: ShortcutLabel,
  platform: ShortcutPlatform = resolve_shortcut_platform(),
): string {
  return SHORTCUT_ARIA_KEYS[platform][action];
}

/** 只接受平台主修饰键，排除带额外修饰键的其它操作。 */
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

/** 输入法组字期间保留按键，其余事件按动作键匹配。 */
function is_primary_shortcut_event(
  event: ShortcutKeyboardEvent,
  action: PrimaryShortcutAction,
  platform: ShortcutPlatform,
): boolean {
  if (event.isComposing || !has_plain_primary_modifier(event, platform)) {
    return false;
  }

  return event.key.toLowerCase() === PRIMARY_SHORTCUT_KEYS[action];
}

/** 删除动作遵循各平台惯用键位。 */
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

/** 按动作选择主修饰键或删除键的匹配规则。 */
export function is_action_shortcut_event(
  event: ShortcutKeyboardEvent,
  action: ShortcutAction,
  platform: ShortcutPlatform = resolve_shortcut_platform(),
): boolean {
  if (action === "delete") {
    return is_delete_shortcut_event(event, platform);
  }

  return is_primary_shortcut_event(event, action, platform);
}

/** 弹窗拥有其内部按键，页面级动作需避开该区域。 */
function is_element_inside_dialog(element: Element): boolean {
  return element.closest("[role='dialog'], [role='alertdialog']") !== null;
}

/** 原生输入、富文本与代码编辑器共同构成文本编辑目标。 */
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

/** 页面级动作只在当前交互目标不会争用同一按键时接管事件。 */
export function should_ignore_action_shortcut_event(
  event: ShortcutKeyboardEvent,
  allow_in_text_editing = false,
): boolean {
  if (!(event.target instanceof Element)) {
    return false;
  }

  // 调用方只能放宽文本编辑目标；Dialog 始终隔离页面级快捷键。
  return (
    is_element_inside_dialog(event.target) ||
    (!allow_in_text_editing && is_element_text_editing_target(event.target))
  );
}

type DialogKeyboardEvent = ShortcutKeyboardEvent & Pick<KeyboardEvent, "repeat">;

/**
 * 判断弹窗内按键是否触发主操作。
 *
 * 嵌套弹窗和菜单经 Portal 渲染但 React 事件仍会冒泡，因此按 DOM 包含关系只处理本弹窗内的按键。
 * 回车只在弹窗本身或单行输入框上提交，按钮、链接、多行输入与编辑器保留原生回车语义。
 */
export function is_dialog_primary_shortcut_event(
  event: DialogKeyboardEvent,
  shortcut: DialogShortcut,
  popup: Element,
  platform: ShortcutPlatform = resolve_shortcut_platform(),
): boolean {
  if (event.repeat || !(event.target instanceof Node)) {
    return false;
  }

  if (!popup.contains(event.target)) {
    return false;
  }

  if (shortcut === "save") {
    return is_action_shortcut_event(event, "save", platform);
  }

  if (
    event.key !== "Enter" ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  return event.target === popup || event.target instanceof HTMLInputElement;
}
