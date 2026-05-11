import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useActionShortcut } from "@/hooks/use-action-shortcut";
import type { ShortcutAction } from "@/lib/keyboard-shortcuts";

type ShortcutProbeProps = {
  action: ShortcutAction;
  enabled: boolean;
  on_trigger: () => void;
};

function ShortcutProbe(props: ShortcutProbeProps): JSX.Element | null {
  useActionShortcut({
    action: props.action,
    enabled: props.enabled,
    on_trigger: props.on_trigger,
  });

  return null;
}

function create_keydown_event(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

describe("useActionShortcut", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function render_probe(props: ShortcutProbeProps): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ShortcutProbe {...props} />);
    });
  }

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it("启用后命中快捷键会阻止默认行为并触发回调", async () => {
    const on_trigger = vi.fn();
    await render_probe({ action: "create", enabled: true, on_trigger });

    const event = create_keydown_event("n", { ctrlKey: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(on_trigger).toHaveBeenCalledTimes(1);
  });

  it("禁用时不会触发回调", async () => {
    const on_trigger = vi.fn();
    await render_probe({ action: "save", enabled: false, on_trigger });

    const event = create_keydown_event("s", { ctrlKey: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(on_trigger).not.toHaveBeenCalled();
  });

  it("页面级删除快捷键在输入、编辑器和弹窗内容中不会触发页面删除", async () => {
    const on_trigger = vi.fn();
    const input = document.createElement("input");
    const editor_child = document.createElement("span");
    const editor = document.createElement("div");
    const dialog_content = document.createElement("div");

    await render_probe({ action: "delete", enabled: true, on_trigger });

    editor.className = "cm-editor";
    editor.append(editor_child);
    dialog_content.setAttribute("data-slot", "dialog-content");
    document.body.append(input, editor, dialog_content);

    input.dispatchEvent(create_keydown_event("Delete"));
    editor_child.dispatchEvent(create_keydown_event("Delete"));
    dialog_content.dispatchEvent(create_keydown_event("Delete"));

    expect(on_trigger).not.toHaveBeenCalled();

    input.remove();
    editor.remove();
    dialog_content.remove();
  });

  it("页面级新增快捷键在弹窗内容中不会触发页面新增", async () => {
    const on_trigger = vi.fn();
    const dialog_content = document.createElement("div");

    await render_probe({ action: "create", enabled: true, on_trigger });

    dialog_content.setAttribute("data-slot", "dialog-content");
    document.body.append(dialog_content);
    dialog_content.dispatchEvent(create_keydown_event("n", { ctrlKey: true }));

    expect(on_trigger).not.toHaveBeenCalled();

    dialog_content.remove();
  });
});
