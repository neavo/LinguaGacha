import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolve_translation_task_metrics,
  create_empty_batch_translation_snapshot,
} from "@shared/batch-translation/batch-translation";
import { AgentTaskStatus } from "./agent-task-status";

const task = vi.hoisted(() => ({
  metrics: {} as ReturnType<typeof resolve_translation_task_metrics>,
  open: vi.fn(),
  percent: null as number | null,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/session/batch-translation/batch-translation-session-context", () => ({
  useBatchTranslationSession: () => ({
    batch_translation_task: {
      translation_task_metrics: task.metrics,
      open_translation_detail_sheet: task.open,
    },
  }),
}));

vi.mock("@frontend/app/session/project-translation-stats-context", () => ({
  useProjectTranslationStats: () =>
    task.percent === null ? null : { completion_percent: task.percent },
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
  });
  /** 在同一挂载中切换翻译终态，验证 `doing` 的恢复。 */
  async function render(
    status: "running" | "stopping" | "stopped",
    doing: string | null,
    percent: number | null = 80,
    running = true,
  ): Promise<HTMLDivElement> {
    task.percent = percent;
    task.metrics = resolve_translation_task_metrics({
      snapshot: {
        ...create_empty_batch_translation_snapshot(),
        status,
        progress: {
          ...create_empty_batch_translation_snapshot().progress,
          start_time: 10,
          total_output_tokens: 100,
          line: 100,
          total_line: 400,
        },
      },
      now_seconds: 20,
    });
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<AgentTaskStatus doing={doing} running={running} />));
    return container;
  }
  it("翻译期间替换 doing 并打开详情，停止收尾后恢复最新事项", async () => {
    const doing = "检查章节";
    const view = await render("running", doing);
    expect(view.textContent).toContain("batch_translation.summary.running");
    expect(view.textContent).not.toContain(doing);
    await act(async () => view.querySelector("button")?.click());
    expect(task.open).toHaveBeenCalledOnce();
    await render("stopping", "汇总结果");
    expect(view.querySelector("button")?.textContent).toContain(
      "batch_translation.summary.stopping",
    );
    await render("stopped", "汇总结果");
    expect(view.querySelector('[role="status"]')?.textContent).toContain("汇总结果");
  });
  it("没有 doing 也显示翻译入口，结束后收起", async () => {
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

  it("工程统计就绪后将完成率传入摘要", async () => {
    const view = await render("running", null, null);
    expect(view.querySelector('[role="progressbar"]')).toBeNull();
    await render("running", null, 80);
    expect(view.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("80");
  });
});
