import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchTranslationDetailSheet } from "@frontend/features/batch-translation/batch-translation-detail-sheet";
import type { BatchTranslationDetailDisplay } from "@frontend/features/batch-translation/batch-translation-display";

const running_display: BatchTranslationDetailDisplay = {
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
        <BatchTranslationDetailSheet
          open={true}
          display={props.display ?? running_display}
          on_close={vi.fn()}
          on_request_stop_confirmation={props.on_request_stop_confirmation ?? vi.fn()}
        />,
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
});
