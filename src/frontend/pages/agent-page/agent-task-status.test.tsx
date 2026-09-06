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
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
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
  /** 在同一挂载中切换翻译终态，验证 Todo 的恢复。 */
  async function render(status: "running" | "stopping" | "stopped", todos: string[]) {
    task.metrics = resolve_translation_task_metrics({
      snapshot: {
        ...create_empty_batch_translation_snapshot(),
        status,
        progress: {
          ...create_empty_batch_translation_snapshot().progress,
          start_time: 10,
          total_output_tokens: 100,
        },
      },
      now_seconds: 20,
    });
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<AgentTaskStatus todos={todos} running={true} />));
    return container;
  }
  it("翻译期间替换 Todo 并打开详情，停止收尾后恢复有序待办", async () => {
    const todos = ["检查章节", "汇总结果"];
    const view = await render("running", todos);
    expect(view.textContent).toContain("batch_translation.summary.running");
    expect(view.textContent).not.toContain(todos[0]);
    await act(async () => view.querySelector("button")?.click());
    expect(task.open).toHaveBeenCalledOnce();
    await render("stopping", todos);
    expect(view.querySelector("button")?.textContent).toContain(
      "batch_translation.summary.stopping",
    );
    await render("stopped", todos);
    expect(view.querySelector('[role="status"]')?.textContent).toContain(todos[0]);
  });
  it("没有 Todo 也显示翻译入口，结束后收起", async () => {
    const view = await render("running", []);
    expect(view.querySelector("button")).not.toBeNull();
    await render("stopped", []);
    expect(view.innerHTML).toBe("");
  });
});
