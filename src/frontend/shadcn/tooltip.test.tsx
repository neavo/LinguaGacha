import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

describe("Tooltip", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => vi.useFakeTimers());

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  async function render(): Promise<HTMLButtonElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <TooltipProvider delay={0}>
          <Tooltip>
            <TooltipTrigger>提示按钮</TooltipTrigger>
            <TooltipContent>提示内容</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button");
    if (trigger === null) throw new Error("缺少 Tooltip 触发器");
    return trigger;
  }

  function move_pointer(target: HTMLElement, x: number, y: number): void {
    target.dispatchEvent(
      new MouseEvent("mouseenter", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
    target.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }),
    );
  }

  it("窗口恢复时关闭提示并忽略静止鼠标，真实移动后恢复悬停提示", async () => {
    const trigger = await render();

    await act(async () => {
      move_pointer(trigger, 10, 10);
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')).toBeNull();

    await act(async () => window.dispatchEvent(new Event("focus")));
    const restored_trigger = container?.querySelector<HTMLButtonElement>("button");
    if (restored_trigger === undefined || restored_trigger === null) {
      throw new Error("缺少恢复后的 Tooltip 触发器");
    }
    await act(async () => {
      move_pointer(restored_trigger, 10, 10);
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')).toBeNull();

    await act(async () => {
      move_pointer(restored_trigger, 20, 10);
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')).not.toBeNull();
  });
});
