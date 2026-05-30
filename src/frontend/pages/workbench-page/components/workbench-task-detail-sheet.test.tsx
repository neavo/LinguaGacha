import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchTaskDetailSheet } from "@frontend/pages/workbench-page/components/workbench-task-detail-sheet";
import type { WorkbenchTaskDetailDisplay } from "@frontend/pages/workbench-page/types";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const running_display: WorkbenchTaskDetailDisplay = {
  title: "翻译任务",
  description: "正在处理当前项目",
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

describe("WorkbenchTaskDetailSheet", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function render_sheet(
    props: {
      display?: WorkbenchTaskDetailDisplay;
      on_request_stop_confirmation?: () => void;
    } = {},
  ): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkbenchTaskDetailSheet
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
    document.body.replaceChildren();
  });

  it("按 display 渲染详情指标和停止入口", async () => {
    await render_sheet();

    expect(document.body.textContent).toContain("速度趋势");
    expect(document.body.textContent).toContain("42%");
    expect(document.body.textContent).toContain("已处理");
    expect(document.body.textContent).toContain("42");
    expect(document.body.textContent).toContain("停止任务");
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
