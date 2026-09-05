import { act, createRef, type RefObject } from "react";
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

  /** 挂载真实提示原语，可选地接入消费方的 actionsRef。 */
  async function render(
    actions_ref?: RefObject<{ close: () => void; unmount: () => void } | null>,
  ): Promise<HTMLButtonElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <TooltipProvider delay={0}>
          <Tooltip actionsRef={actions_ref}>
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

  /** 按指针移动和鼠标悬停顺序模拟窗口恢复后的交互。 */
  async function move_pointer(
    target: HTMLElement,
    x: number,
    y: number,
    enter = false,
  ): Promise<void> {
    await act(async () =>
      target.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }),
      ),
    );
    await act(async () => {
      if (enter)
        target.dispatchEvent(
          new MouseEvent("mouseenter", { bubbles: true, clientX: x, clientY: y }),
        );
      target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      vi.runAllTimers();
    });
  }

  it.each([false, true])("窗口恢复后由真实移动恢复提示，外部 actionsRef=%s", async (external) => {
    const trigger = await render(external ? createRef() : undefined);

    await move_pointer(trigger, 10, 10, true);
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
    expect(restored_trigger).toBe(trigger);
    await move_pointer(restored_trigger, 10, 10);
    expect(document.querySelector('[role="tooltip"][data-open]')).toBeNull();

    await move_pointer(restored_trigger, 20, 10);
    expect(document.querySelector('[role="tooltip"][data-open]')).not.toBeNull();
  });
});
