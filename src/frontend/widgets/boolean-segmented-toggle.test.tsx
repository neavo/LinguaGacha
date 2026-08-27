import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";

describe("BooleanSegmentedToggle", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("直接向调用方返回布尔值", async () => {
    const on_value_change = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <LocaleProvider locale="zh-CN">
          <BooleanSegmentedToggle
            aria_label="功能状态"
            value={false}
            on_value_change={on_value_change}
          />
        </LocaleProvider>,
      ),
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => buttons[1]?.click());
    expect(on_value_change).toHaveBeenCalledWith(true);
  });
});
