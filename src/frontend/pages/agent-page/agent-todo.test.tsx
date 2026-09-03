import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  TooltipTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
}));

import { AgentTodo } from "./agent-todo";

describe("AgentTodo", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  /** 复用同一根节点验证 Todo 更新与清空后的公开 DOM。 */
  async function render_todo(todos: readonly string[]): Promise<Element> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<AgentTodo todos={todos} running={false} />));
    return container;
  }

  it("展示队首并在提示中保留完整 Todo，空列表时不占位", async () => {
    const view = await render_todo(["读取工程", "检查章节", "汇总结果"]);
    const status = view.querySelector<HTMLElement>('[role="status"]');
    const tooltip_items = [...view.querySelectorAll('[role="tooltip"] li')].map(
      (item) => item.textContent,
    );

    expect(status?.textContent).toContain("读取工程");
    expect(status?.tabIndex).toBe(0);
    expect(tooltip_items).toEqual(["读取工程", "检查章节", "汇总结果"]);

    await render_todo([]);
    expect(view.querySelector('[role="status"]')).toBeNull();
    expect(view.querySelector('[role="tooltip"]')).toBeNull();
  });
});
