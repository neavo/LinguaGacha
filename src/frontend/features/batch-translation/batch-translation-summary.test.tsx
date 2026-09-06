import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchTranslationSummary } from "@frontend/features/batch-translation/batch-translation-summary";
import type { BatchTranslationSummaryDisplay } from "@frontend/features/batch-translation/batch-translation-display";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const running_display: BatchTranslationSummaryDisplay = {
  status_text: "翻译中",
  trailing_text: "12 Line/s",
  tone: "warning",
  show_spinner: true,
  detail_tooltip_text: "点击查看详情",
};

type RenderSummaryProps = {
  active?: boolean;
  on_open?: () => void;
};

describe("BatchTranslationSummary", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  /** 以任务活跃态驱动摘要，观察提示与详情入口。 */
  async function render_summary(props: RenderSummaryProps = {}): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <BatchTranslationSummary
            display={{ ...running_display, show_spinner: props.active ?? false }}
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

  it("空闲时等待用户打开详情提示", async () => {
    await render_summary();

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("任务活跃时提示详情入口，点击后收起提示并打开详情", async () => {
    const on_open = vi.fn();
    await render_summary({ active: true, on_open });
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();

    const trigger = container?.querySelector("button");
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(on_open).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });
});
