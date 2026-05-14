import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskRuntimeSummary } from "@/pages/workbench-page/components/task-runtime/task-runtime-summary";
import type { WorkbenchTaskSummaryViewModel } from "@/pages/workbench-page/types";
import { TooltipProvider } from "@/shadcn/tooltip";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const running_view_model: WorkbenchTaskSummaryViewModel = {
  status_text: "翻译中",
  trailing_text: "12 Line/s",
  tone: "warning",
  show_spinner: true,
  detail_tooltip_text: "点击查看详情",
};

type RenderSummaryProps = {
  can_open?: boolean;
  auto_open_key?: string | null;
  on_open?: () => void;
};

describe("TaskRuntimeSummary", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function render_summary(props: RenderSummaryProps = {}): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <TaskRuntimeSummary
            view_model={running_view_model}
            can_open={props.can_open ?? true}
            auto_open_key={props.auto_open_key ?? null}
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

  it("收到自动打开键后展示详情提示", async () => {
    await render_summary({ auto_open_key: "translation" });

    expect(document.body.textContent).toContain("点击查看详情");
  });

  it("自动打开键为空时不主动展示详情提示", async () => {
    await render_summary({ auto_open_key: null });

    expect(document.body.textContent).not.toContain("点击查看详情");
  });

  it("点击胶囊时关闭提示并打开详情", async () => {
    const on_open = vi.fn();
    await render_summary({ auto_open_key: "translation", on_open });

    const trigger = container?.querySelector("button");
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(on_open).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("点击查看详情");
  });
});
