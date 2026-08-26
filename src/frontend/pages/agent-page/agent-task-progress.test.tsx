import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
}));

import { AgentTaskProgress } from "./agent-task-progress";

describe("AgentTaskProgress", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render_progress(
    pending_labels: readonly string[],
    running = false,
  ): Promise<Element> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () =>
      root?.render(<AgentTaskProgress pending_labels={pending_labels} running={running} />),
    );
    return container;
  }

  it("固定展示队首，并在 shadcn 提示中分行保留完整待办", async () => {
    const view = await render_progress(["读取工程", "检查章节", "汇总结果"], true);
    const progress = view.querySelector(".agent-task-progress");
    const tooltip_items = [...view.querySelectorAll('[role="tooltip"] li')].map(
      (item) => item.textContent,
    );

    expect(progress?.querySelector(".agent-task-progress__item")?.textContent).toBe("读取工程");
    expect(progress?.querySelector(".agent-task-progress__label")?.textContent).toBe(
      "agent_page.task_progress.pending",
    );
    expect(progress?.querySelector(".agent-status-mark--running")).not.toBeNull();
    expect(progress?.querySelector(".agent-task-progress__more")?.textContent).toBe("+2");
    expect((progress as HTMLElement | null)?.tabIndex).toBe(0);
    expect(tooltip_items).toEqual(["读取工程", "检查章节", "汇总结果"]);

    await render_progress(["读取工程"]);
    expect(view.querySelector(".agent-status-mark--running")).toBeNull();
    expect(view.querySelector(".agent-status-mark")).not.toBeNull();
    expect(view.querySelector(".agent-task-progress__more")).toBeNull();
    expect(
      [...view.querySelectorAll('[role="tooltip"] li')].map((item) => item.textContent),
    ).toEqual(["读取工程"]);

    await render_progress([]);
    expect(view.querySelector(".agent-task-progress")).toBeNull();
    expect(view.querySelector('[role="tooltip"]')).toBeNull();
  });
});
