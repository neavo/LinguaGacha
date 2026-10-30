import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  SegmentedProgress,
  type SegmentedProgressStats,
} from "@frontend/widgets/segmented-progress/segmented-progress";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const labels = {
  skipped: "无需",
  completed: "成功",
  pending: "等待",
  total: "总计",
};

describe("SegmentedProgress", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

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

  /** 挂载真实分段控件，观察计数如何映射为宽度。 */
  async function render_progress(stats: SegmentedProgressStats): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(TooltipProvider, null, createElement(SegmentedProgress, { stats, labels })),
      );
    });

    return container;
  }

  it("按总量计算非零分段宽度，零值不占空间", async () => {
    const view = await render_progress({
      total_items: 10,
      completed_count: 3,
      pending_count: 7,
      skipped_count: 0,
      completion_percent: 30,
    });

    const segments = view.querySelectorAll<HTMLElement>(".segmented-progress__segment");
    expect([...segments].map((segment) => segment.style.width)).toEqual(["30%", "70%"]);
    expect(view.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("30");
  });

  it("0 总数时保留空轨道且不渲染分段", async () => {
    const view = await render_progress({
      total_items: 0,
      completed_count: 0,
      pending_count: 0,
      skipped_count: 0,
      completion_percent: 0,
    });

    expect(view.querySelectorAll(".segmented-progress__segment")).toHaveLength(0);
    expect(view.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("0");
  });
});
