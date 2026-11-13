import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { batch_task_metrics, empty_batch_task_snapshot } from "@shared/batch-task";
import { empty_batch_task_progress, type BatchTaskKind } from "@domain/batch-task";
import { AgentTaskStatus } from "./agent-task-status";

const task = vi.hoisted(() => ({
  kind: "translation" as BatchTaskKind,
  metrics: {} as ReturnType<typeof batch_task_metrics>,
  open: vi.fn(),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/session/batch-task/batch-task-session-context", () => ({
  useBatchTaskSession: () => ({
    batch_task: {
      task_metrics: task.metrics,
      task_display_snapshot: { kind: task.kind },
      open_task_detail_sheet: task.open,
    },
  }),
}));

describe("AgentTaskStatus", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    task.open.mockClear();
    task.kind = "translation";
  });
  /** 在同一挂载中切换批量任务终态，验证 `doing` 的恢复。 */
  async function render(
    status: "running" | "stopping" | "stopped",
    doing: string | null,
    percent: number | null = 80,
    running = true,
  ): Promise<HTMLDivElement> {
    task.metrics = batch_task_metrics(
      {
        ...empty_batch_task_snapshot(),
        status,
        kind: task.kind,
        progress:
          percent === null
            ? null
            : {
                ...empty_batch_task_progress(task.kind === "translation" ? "item" : "request", 400),
                start_time: 10,
                output_tokens: 100,
                succeeded: percent * 4,
              },
      },
      20,
    );
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<AgentTaskStatus doing={doing} running={running} />));
    return container;
  }
  it.each(["translation", "request"] as const)(
    "%s 期间替换 doing 并打开详情，停止后恢复最新事项",
    async (kind) => {
      task.kind = kind;
      const doing = "检查章节";
      const view = await render("running", doing);
      expect(view.textContent).toContain(`batch_translation.summary.${kind}.running`);
      expect(view.textContent).not.toContain(doing);
      await act(async () => view.querySelector("button")?.click());
      expect(task.open).toHaveBeenCalledOnce();
      await render("stopping", "汇总结果");
      expect(view.querySelector("button")?.textContent).toContain(
        `batch_translation.summary.${kind}.stopping`,
      );
      await render("stopped", "汇总结果");
      expect(view.querySelector('[role="status"]')?.textContent).toContain("汇总结果");
    },
  );
  it("没有 doing 也显示批量任务入口，结束后收起", async () => {
    const view = await render("running", null);
    expect(view.querySelector("button")).not.toBeNull();
    await render("stopped", null);
    expect(view.innerHTML).toBe("");
  });

  it("运行状态独立控制动画，停止后保留文本并允许清空", async () => {
    const text = "检查第三章的术语一致性";
    const view = await render("stopped", text);
    expect(view.querySelector(".agent-status-mark--running")).not.toBeNull();
    await render("stopped", text, 80, false);
    expect(view.querySelector('[role="status"]')?.textContent).toContain(text);
    expect(view.querySelector(".agent-status-mark--running")).toBeNull();
    await render("stopped", null, 80, false);
    expect(view.innerHTML).toBe("");
  });

  it("本轮目标就绪后将处理进度传入摘要", async () => {
    const view = await render("running", null, null);
    expect(view.querySelector('[role="progressbar"]')).toBeNull();
    await render("running", null, 80);
    expect(view.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("80");
  });
});
