import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentedToggle } from "./segmented-toggle";

describe("SegmentedToggle", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render(on_value_change = vi.fn()): Promise<HTMLButtonElement[]> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <SegmentedToggle
          aria_label="模式"
          value="smart"
          options={[
            { value: "off", label: "关闭" },
            { value: "smart", label: "智能" },
          ]}
          on_value_change={on_value_change}
        />,
      ),
    );
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  }

  it("使用 Base UI 的按下状态呈现主题色激活项", async () => {
    const buttons = await render();
    const active_button = buttons[1];

    expect(active_button?.getAttribute("aria-pressed")).toBe("true");
    expect(active_button?.hasAttribute("data-pressed")).toBe(true);
  });

  it("切换选项并保持单选值不可清空", async () => {
    const on_value_change = vi.fn();
    const buttons = await render(on_value_change);

    await act(async () => buttons[0]?.click());
    expect(on_value_change).toHaveBeenCalledWith("off");

    on_value_change.mockClear();
    await act(async () => buttons[1]?.click());
    expect(on_value_change).not.toHaveBeenCalled();
  });
});
