import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import type { ShortcutAction } from "@frontend/widgets/interactions/keyboard-shortcuts";

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
});
