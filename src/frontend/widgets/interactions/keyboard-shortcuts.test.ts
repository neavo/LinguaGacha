import { describe, expect, it } from "vitest";

import {
  is_action_shortcut_event,
  is_dialog_primary_shortcut_event,
  resolve_shortcut_platform,
  should_ignore_action_shortcut_event,
} from "./keyboard-shortcuts";

type ShortcutEventInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  target?: EventTarget | null;
};

/** 为匹配规则提供显式修饰键与目标，排除浏览器默认值干扰。 */
function create_shortcut_event(input: ShortcutEventInput): KeyboardEvent {
  return {
    key: input.key,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: input.metaKey ?? false,
    altKey: input.altKey ?? false,
    shiftKey: input.shiftKey ?? false,
    isComposing: input.isComposing ?? false,
    repeat: input.repeat ?? false,
    target: input.target ?? null,
  } as KeyboardEvent;
}

describe("keyboard shortcuts", () => {
  it.each([
    ["MacIntel", "mac"],
    ["Win32", "default"],
  ] as const)("把 %s 识别为 %s 平台", (platform, expected) => {
    expect(resolve_shortcut_platform({ platform })).toBe(expected);
  });

  it.each([
    ["default", "save", { key: "s", ctrlKey: true }, true],
    ["default", "follow_latest", { key: "e", ctrlKey: true }, true],
    ["default", "toggle_sidebar", { key: "b", ctrlKey: true }, true],
    ["default", "delete", { key: "Delete" }, true],
    ["default", "save", { key: "s", metaKey: true }, false],
    ["mac", "follow_latest", { key: "e", metaKey: true }, true],
    ["mac", "toggle_sidebar", { key: "b", metaKey: true }, true],
    ["mac", "save", { key: "s", metaKey: true }, true],
    ["mac", "delete", { key: "Backspace", metaKey: true }, true],
    ["default", "save", { key: "s", ctrlKey: true, isComposing: true }, false],
    ["default", "create", { key: "n", ctrlKey: true, altKey: true }, false],
    ["default", "follow_latest", { key: "e", ctrlKey: true, shiftKey: true }, false],
  ] as const)("%s 平台的 %s 快捷键（%o）匹配结果为 %s", (platform, action, input, expected) => {
    expect(is_action_shortcut_event(create_shortcut_event(input), action, platform)).toBe(expected);
  });

  it.each(["dialog", "alertdialog"])("页面级快捷键避开输入框、编辑器与 %s", (role) => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    const editor_child = document.createElement("span");
    const dialog = document.createElement("div");
    const dialog_child = document.createElement("button");
    editor.className = "cm-editor";
    editor.append(editor_child);
    dialog.setAttribute("role", role);
    dialog.append(dialog_child);
    document.body.append(input, editor, dialog);

    try {
      expect(
        [input, editor_child, dialog_child].map((target) =>
          should_ignore_action_shortcut_event(create_shortcut_event({ key: "Delete", target })),
        ),
      ).toEqual([true, true, true]);
      expect(
        should_ignore_action_shortcut_event(
          create_shortcut_event({ key: "e", ctrlKey: true, target: dialog_child }),
          true,
        ),
      ).toBe(true);
      expect(
        should_ignore_action_shortcut_event(
          create_shortcut_event({ key: "n", target: editor_child }),
          true,
        ),
      ).toBe(false);
    } finally {
      input.remove();
      editor.remove();
      dialog.remove();
    }
  });

  it("弹窗主操作只响应本弹窗内的有效按键", () => {
    const popup = document.createElement("div");
    const input = document.createElement("input");
    const button = document.createElement("button");
    const textarea = document.createElement("textarea");
    const outside = document.createElement("input");
    popup.append(input, button, textarea);
    document.body.append(popup, outside);

    try {
      const cases: [ShortcutEventInput, "save" | "submit", boolean][] = [
        [{ key: "Enter", target: popup }, "submit", true],
        [{ key: "Enter", target: input }, "submit", true],
        [{ key: "Enter", target: button }, "submit", false],
        [{ key: "Enter", target: textarea }, "submit", false],
        [{ key: "Enter", target: outside }, "submit", false],
        [{ key: "Enter", target: input, isComposing: true }, "submit", false],
        [{ key: "Enter", target: input, shiftKey: true }, "submit", false],
        [{ key: "Enter", target: input, repeat: true }, "submit", false],
        [{ key: "Enter", target: input }, "save", false],
        [{ key: "s", ctrlKey: true, target: textarea }, "save", true],
        [{ key: "s", ctrlKey: true, target: outside }, "save", false],
        [{ key: "s", ctrlKey: true, target: input }, "submit", false],
      ];
      expect(
        cases.map(([input_event, shortcut]) =>
          is_dialog_primary_shortcut_event(
            create_shortcut_event(input_event),
            shortcut,
            popup,
            "default",
          ),
        ),
      ).toEqual(cases.map(([, , expected]) => expected));
    } finally {
      popup.remove();
      outside.remove();
    }
  });
});
