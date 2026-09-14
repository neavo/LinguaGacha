import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchTranslationSummary } from "@frontend/features/batch-translation/batch-translation-summary";
import type { BatchTranslationSummaryDisplay } from "@frontend/features/batch-translation/batch-translation-display";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const running_display: BatchTranslationSummaryDisplay = {
  status_text: "翻译中",
  speed_text: "2.47 KT/S",
  tone: "success",
  detail_tooltip_text: "点击查看详情",
};

type RenderSummaryProps = {
  open_tooltip_on_start?: boolean;
  active?: boolean;
  on_open?: () => void;
  completion_percent?: number | null;
  stopping?: boolean;
};

describe("BatchTranslationSummary", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  /** 以任务活跃态驱动摘要，观察提示与详情入口。 */
  async function render_summary(props: RenderSummaryProps = {}): Promise<void> {
    const active = Boolean(props.active || props.stopping);
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <BatchTranslationSummary
            variant="capsule"
            open_tooltip_on_start={props.open_tooltip_on_start ?? false}
            display={{
              ...running_display,
              speed_text: active ? running_display.speed_text : null,
              status_text: props.stopping ? "停止中" : active ? "翻译中" : "无任务",
              tone: props.stopping ? "warning" : active ? "success" : "neutral",
            }}
            completion_percent={props.completion_percent ?? null}
            on_open={props.on_open ?? vi.fn()}
          />
        </TooltipProvider>,
      );
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

  it("任务活跃时提示详情入口，点击后收起提示并打开详情", async () => {
    const on_open = vi.fn();
    await render_summary({ on_open, open_tooltip_on_start: true });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    await render_summary({ active: true, on_open, open_tooltip_on_start: true });
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();

    const trigger = container?.querySelector("button");
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(on_open).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("未开启主动提示时，任务开始后等待用户交互", async () => {
    await render_summary({ active: true });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("获得工程统计后显示进度，并跟随统计增减和边界值", async () => {
    await render_summary({ active: true });
    expect(container?.querySelector('[role="progressbar"]')).toBeNull();

    for (const completion_percent of [80, 40, 0, 100]) {
      await render_summary({ active: true, completion_percent });
      const progress = container?.querySelector('[role="progressbar"]');
      expect(progress?.getAttribute("aria-valuenow")).toBe(String(completion_percent));
      expect(progress?.closest("button")).toBeNull();
    }
  });

  it("停止中继续更新进度，任务结束后收起填充", async () => {
    await render_summary({ active: true, completion_percent: 40 });
    await render_summary({ active: true, stopping: true, completion_percent: 60 });
    const progress = container?.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("60");
    expect(progress?.getAttribute("aria-label")).toBe("停止中");

    await render_summary({ completion_percent: 60 });
    expect(container?.querySelector('[role="progressbar"]')).toBeNull();
    expect(container?.querySelector("button")?.textContent).not.toContain(
      running_display.speed_text,
    );
  });
});
