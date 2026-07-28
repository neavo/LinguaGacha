import { describe, expect, it } from "vitest";

import {
  get_shortcut_label,
  is_action_shortcut_event,
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
  target?: EventTarget | null;
};

function create_shortcut_event(input: ShortcutEventInput): KeyboardEvent {
  return {
    key: input.key,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: input.metaKey ?? false,
    altKey: input.altKey ?? false,
    shiftKey: input.shiftKey ?? false,
    isComposing: input.isComposing ?? false,
    target: input.target ?? null,
  } as KeyboardEvent;
}

describe("keyboard shortcuts", () => {
  it("按平台生成动作标签", () => {
    expect(
      (["save", "create", "delete", "cancel"] as const).map((action) =>
        get_shortcut_label(action, "default"),
      ),
    ).toEqual(["Ctrl+S", "Ctrl+N", "Del", "Esc"]);
    expect(
      (["save", "create", "delete", "cancel"] as const).map((action) =>
        get_shortcut_label(action, "mac"),
      ),
    ).toEqual(["⌘S", "⌘N", "⌘⌫", "Esc"]);
  });

  it.each([
    ["MacIntel", "mac"],
    ["Win32", "default"],
    ["Linux x86_64", "default"],
  ] as const)("把 %s 识别为 %s 平台", (platform, expected) => {
    expect(resolve_shortcut_platform({ platform })).toBe(expected);
  });

  it.each([
    ["default", "save", { key: "s", ctrlKey: true }, true],
    ["default", "create", { key: "n", ctrlKey: true }, true],
    ["default", "delete", { key: "Delete" }, true],
    ["default", "save", { key: "s", metaKey: true }, false],
    ["default", "delete", { key: "Backspace" }, false],
    ["mac", "save", { key: "s", metaKey: true }, true],
    ["mac", "create", { key: "n", metaKey: true }, true],
    ["mac", "delete", { key: "Backspace", metaKey: true }, true],
    ["mac", "save", { key: "s", ctrlKey: true }, false],
    ["mac", "delete", { key: "Backspace" }, false],
    ["default", "save", { key: "s", ctrlKey: true, isComposing: true }, false],
    ["default", "create", { key: "n", ctrlKey: true, altKey: true }, false],
    ["default", "create", { key: "n", ctrlKey: true, shiftKey: true }, false],
  ] as const)("%s 平台的 %s 快捷键（%o）匹配结果为 %s", (platform, action, input, expected) => {
    expect(is_action_shortcut_event(create_shortcut_event(input), action, platform)).toBe(expected);
  });

  it("页面级新增和删除避开输入框、编辑器与弹窗", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    const editor_child = document.createElement("span");
    const dialog = document.createElement("div");
    const dialog_child = document.createElement("button");
    editor.className = "cm-editor";
    editor.append(editor_child);
    dialog.setAttribute("data-slot", "dialog-content");
    dialog.append(dialog_child);
    document.body.append(input, editor, dialog);

    try {
      expect(
        [input, editor_child, dialog_child].map((target) =>
          should_ignore_action_shortcut_event(
            create_shortcut_event({ key: "Delete", target }),
            "delete",
          ),
        ),
      ).toEqual([true, true, true]);
      expect(
        should_ignore_action_shortcut_event(
          create_shortcut_event({ key: "n", target: dialog_child }),
          "create",
        ),
      ).toBe(true);
      expect(
        should_ignore_action_shortcut_event(
          create_shortcut_event({ key: "s", target: input }),
          "save",
        ),
      ).toBe(false);
    } finally {
      input.remove();
      editor.remove();
      dialog.remove();
    }
  });
});
