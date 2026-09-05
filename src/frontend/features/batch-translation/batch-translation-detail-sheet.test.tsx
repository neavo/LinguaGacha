import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchTranslationDetailSheet } from "@frontend/features/batch-translation/batch-translation-detail-sheet";
import type { BatchTranslationDetailDisplay } from "@frontend/features/batch-translation/batch-translation-display";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const running_display: BatchTranslationDetailDisplay = {
  provider: null,
  waveform_title: "速度趋势",
  metrics_title: "任务指标",
  completion_percent_text: "42%",
  percent_tone: "warning",
  metric_entries: [
    { key: "lines", label: "已处理", value_text: "42", unit_text: "行" },
    { key: "speed", label: "速度", value_text: "12", unit_text: "行/秒" },
  ],
  stop_button_label: "停止任务",
  stop_disabled: false,
  waveform_history: [1, 3, 2],
};

describe("BatchTranslationDetailSheet", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  /** 挂载真实侧栏并从 DOM 触发停止动作。 */
  async function render_sheet(
    props: {
      display?: BatchTranslationDetailDisplay;
      on_request_stop_confirmation?: () => void;
    } = {},
  ): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <BatchTranslationDetailSheet
            open={true}
            display={props.display ?? running_display}
            on_close={vi.fn()}
            on_request_stop_confirmation={props.on_request_stop_confirmation ?? vi.fn()}
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

  it("点击停止入口后请求确认", async () => {
    const on_request_stop_confirmation = vi.fn();
    await render_sheet({ on_request_stop_confirmation });

    const stop_button = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("停止任务"),
    );
    expect(stop_button).not.toBeUndefined();

    await act(async () => {
      stop_button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(on_request_stop_confirmation).toHaveBeenCalledTimes(1);
  });

  it.each(["hover", "focus"] as const)("接入点通过 %s 显示完整配置信息", async (interaction) => {
    const name = "翻译专用接入点的完整配置名称";
    const model = "provider/translation-model-long-name";
    await render_sheet({
      display: {
        ...running_display,
        provider: { label: "接入点", name, model, thinking: "高" },
      },
    });
    const first = document.querySelector<HTMLElement>('[data-slot="tooltip-trigger"]')!;
    await act(async () => {
      if (interaction === "focus") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        first.focus();
      } else {
        first.dispatchEvent(
          new MouseEvent("mouseenter", { bubbles: true, clientX: 10, clientY: 10 }),
        );
        first.dispatchEvent(
          new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 }),
        );
        first.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }),
        );
      }
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.querySelector('[role="tooltip"][data-open]')).not.toBeNull(),
      );
    });
    const tooltip = document.querySelector('[role="tooltip"][data-open]');
    expect(tooltip?.textContent).toContain(name);
    expect(tooltip?.textContent).toContain(model);
    expect(tooltip?.textContent).toContain("高");
  });
});
