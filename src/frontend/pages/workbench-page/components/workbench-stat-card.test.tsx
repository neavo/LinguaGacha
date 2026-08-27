import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { WorkbenchStatCard } from "./workbench-stat-card";

describe("WorkbenchStatCard", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => vi.useFakeTimers());

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("键盘聚焦时显示提示并用 Enter 切换统计", async () => {
    const on_toggle = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider delay={0}>
          <WorkbenchStatCard
            title="总数"
            value={12}
            unit="行"
            toggle_tooltip="切换统计"
            on_toggle={on_toggle}
          />
        </TooltipProvider>,
      );
    });

    const trigger = container.querySelector<HTMLElement>('[role="button"]');
    if (trigger === null) {
      throw new Error("缺少统计切换入口");
    }
    await act(async () => trigger.focus());
    await act(async () => vi.runAllTimers());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(on_toggle).toHaveBeenCalledOnce();
  });
});
