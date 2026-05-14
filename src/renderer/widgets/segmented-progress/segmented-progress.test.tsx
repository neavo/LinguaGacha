import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  SegmentedProgress,
  type SegmentedProgressStats,
} from "@/widgets/segmented-progress/segmented-progress";
import { TooltipProvider } from "@/shadcn/tooltip";

const labels = {
  skipped: "无需",
  failed: "失败",
  completed: "成功",
  pending: "等待",
  total: "总计",
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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

  it("按无需、失败、成功、等待顺序渲染非零分段", async () => {
    const view = await render_progress({
      total_items: 10,
      completed_count: 3,
      failed_count: 2,
      pending_count: 4,
      skipped_count: 1,
      completion_percent: 40,
    });

    expect(
      Array.from(view.querySelectorAll(".segmented-progress__segment")).map((element) =>
        element.getAttribute("class"),
      ),
    ).toEqual([
      "segmented-progress__segment segmented-progress__segment--skipped",
      "segmented-progress__segment segmented-progress__segment--failed",
      "segmented-progress__segment segmented-progress__segment--completed",
      "segmented-progress__segment segmented-progress__segment--pending",
    ]);
    expect(view.querySelector("[role='progressbar']")?.getAttribute("aria-label")).toBe(
      "无需 - 1 / 失败 - 2 / 成功 - 3 / 等待 - 4 / 总计 - 10",
    );
  });

  it("0 总数时保留空轨道且不渲染分段", async () => {
    const view = await render_progress({
      total_items: 0,
      completed_count: 0,
      failed_count: 0,
      pending_count: 0,
      skipped_count: 0,
      completion_percent: 0,
    });

    expect(view.querySelectorAll(".segmented-progress__segment")).toHaveLength(0);
    expect(view.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("0");
  });
});
