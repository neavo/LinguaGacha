import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchTaskDetailSheet } from "@frontend/features/batch-task/batch-task-detail-sheet";
import type { BatchTaskDetailDisplay } from "@frontend/features/batch-task/batch-task-display";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const running_display: BatchTaskDetailDisplay = {
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

describe("BatchTaskDetailSheet", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  /** 挂载真实侧栏并从 DOM 触发停止动作。 */
  async function render_sheet(
    props: {
      display?: BatchTaskDetailDisplay;
      tasks?: ComponentProps<typeof BatchTaskDetailSheet>["tasks"];
      on_select_task?: (run_id: string) => void;
      on_request_stop_confirmation?: () => void;
    } = {},
  ): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <BatchTaskDetailSheet
            open={true}
            display={props.display ?? running_display}
            tasks={props.tasks ?? []}
            on_select_task={props.on_select_task ?? vi.fn()}
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

  it("单任务不渲染切换栏，多任务展示状态与进度并提交所选运行身份", async () => {
    await render_sheet({
      tasks: [{ run_id: "only", label: "批量翻译", selected: true, status: "running" }],
    });
    expect(document.querySelectorAll("button[aria-pressed]")).toHaveLength(0);

    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;

    const select = vi.fn();
    await render_sheet({
      on_select_task: select,
      tasks: [
        {
          run_id: "translate",
          label: "批量翻译",
          progress_text: "42.00%",
          selected: true,
          status: "running",
        },
        {
          run_id: "request",
          label: "批量请求",
          progress_text: "10.00%",
          selected: false,
          status: "stopping",
        },
      ],
    });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0]?.getAttribute("data-status")).toBe("running");
    expect(buttons[0]?.textContent).toBe("批量翻译42.00%");
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1]?.getAttribute("data-status")).toBe("stopping");
    await act(async () => buttons[1]?.click());
    expect(select).toHaveBeenCalledExactlyOnceWith("request");
  });
  it("键盘聚焦接入点时可查看完整配置", async () => {
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
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      first.focus();
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
