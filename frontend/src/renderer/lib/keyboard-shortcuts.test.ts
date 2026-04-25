import { describe, expect, it } from "vitest";

import {
  get_shortcut_label,
  is_action_shortcut_event,
  resolve_shortcut_platform,
  should_ignore_action_shortcut_event,
  type ShortcutPlatform,
} from "@/lib/keyboard-shortcuts";

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

describe("keyboard-shortcuts", () => {
  it("根据平台生成保存、新增和删除快捷键标签", () => {
    expect(get_shortcut_label("save", "default")).toBe("Ctrl+S");
    expect(get_shortcut_label("create", "default")).toBe("Ctrl+N");
    expect(get_shortcut_label("delete", "default")).toBe("Del");

    expect(get_shortcut_label("save", "mac")).toBe("⌘S");
    expect(get_shortcut_label("create", "mac")).toBe("⌘N");
    expect(get_shortcut_label("delete", "mac")).toBe("⌘⌫");
  });

  it.each([
    ["MacIntel", "mac"],
    ["Win32", "default"],
    ["Linux x86_64", "default"],
  ] as const)("把 %s 识别为 %s 快捷键平台", (platform, expected_platform) => {
    expect(resolve_shortcut_platform({ platform })).toBe(expected_platform);
  });

  it("Windows/Linux 只响应 Ctrl+S、Ctrl+N 和裸 Delete", () => {
    const platform: ShortcutPlatform = "default";

    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "s", ctrlKey: true }),
        "save",
        platform,
      ),
    ).toBe(true);
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "n", ctrlKey: true }),
        "create",
        platform,
      ),
    ).toBe(true);
    expect(
      is_action_shortcut_event(create_shortcut_event({ key: "Delete" }), "delete", platform),
    ).toBe(true);

    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "s", metaKey: true }),
        "save",
        platform,
      ),
    ).toBe(false);
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "n", metaKey: true }),
        "create",
        platform,
      ),
    ).toBe(false);
    expect(
      is_action_shortcut_event(create_shortcut_event({ key: "Backspace" }), "delete", platform),
    ).toBe(false);
  });

  it("macOS 只响应 Command+S、Command+N 和 Command+Backspace", () => {
    const platform: ShortcutPlatform = "mac";

    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "s", metaKey: true }),
        "save",
        platform,
      ),
    ).toBe(true);
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "n", metaKey: true }),
        "create",
        platform,
      ),
    ).toBe(true);
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "Backspace", metaKey: true }),
        "delete",
        platform,
      ),
    ).toBe(true);

    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "s", ctrlKey: true }),
        "save",
        platform,
      ),
    ).toBe(false);
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "n", ctrlKey: true }),
        "create",
        platform,
      ),
    ).toBe(false);
    expect(
      is_action_shortcut_event(create_shortcut_event({ key: "Backspace" }), "delete", platform),
    ).toBe(false);
  });

  it("组合输入、Alt 和 Shift 会阻止保存与新增快捷键", () => {
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "s", ctrlKey: true, isComposing: true }),
        "save",
        "default",
      ),
    ).toBe(false);
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "n", ctrlKey: true, altKey: true }),
        "create",
        "default",
      ),
    ).toBe(false);
    expect(
      is_action_shortcut_event(
        create_shortcut_event({ key: "n", ctrlKey: true, shiftKey: true }),
        "create",
        "default",
      ),
    ).toBe(false);
  });

  it("页面级新增和删除快捷键会避开文本编辑区域和弹窗内容", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    const dialog_content = document.createElement("div");

    editor.className = "cm-editor";
    dialog_content.setAttribute("data-slot", "dialog-content");
    document.body.append(input, editor, dialog_content);

    expect(
      should_ignore_action_shortcut_event(
        create_shortcut_event({ key: "Delete", target: input }),
        "delete",
      ),
    ).toBe(true);
    expect(
      should_ignore_action_shortcut_event(
        create_shortcut_event({ key: "Delete", target: editor }),
        "delete",
      ),
    ).toBe(true);
    expect(
      should_ignore_action_shortcut_event(
        create_shortcut_event({ key: "Delete", target: dialog_content }),
        "delete",
      ),
    ).toBe(true);
    expect(
      should_ignore_action_shortcut_event(
        create_shortcut_event({ key: "n", target: input }),
        "create",
      ),
    ).toBe(true);
    expect(
      should_ignore_action_shortcut_event(
        create_shortcut_event({ key: "n", target: dialog_content }),
        "create",
      ),
    ).toBe(true);
    expect(
      should_ignore_action_shortcut_event(
        create_shortcut_event({ key: "s", target: input }),
        "save",
      ),
    ).toBe(false);

    input.remove();
    editor.remove();
    dialog_content.remove();
  });
});
