import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appearance = vi.hoisted(() => ({ theme: "light" as "light" | "dark" }));

vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: appearance.theme }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { AgentMermaidBlock } from "./agent-mermaid";
import { mermaid_renderer, type MermaidRenderResult } from "./agent-mermaid-renderer";

describe("AgentMermaidBlock", () => {
  let container: HTMLDivElement;
  let root: Root;
  let request: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    appearance.theme = "light";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    request = vi.spyOn(mermaid_renderer, "request");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    request.mockRestore();
    container.remove();
  });

  /** 复用同一组件实例，覆盖源码和主题变化时的真实副作用生命周期。 */
  async function render(source: string): Promise<void> {
    await act(async () => root.render(<AgentMermaidBlock source={source} />));
  }

  it("渲染成功后以整张图作为预览入口，并复用已生成的 SVG", async () => {
    request.mockResolvedValue({ status: "success", svg: '<svg data-diagram="ready"></svg>' });
    await render("flowchart LR\nA-->B");
    await wait_for_condition(() => container.querySelector("svg") !== null);

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    if (trigger === null) throw new Error("缺少图表预览入口");
    expect(container.querySelector("code.language-mermaid")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);

    await act(async () => trigger.click());
    expect(document.body.querySelector('[data-slot="dialog-content"] svg')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("主题变化时重新渲染并忽略旧请求的迟到结果", async () => {
    const first = deferred<MermaidRenderResult>();
    request
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ status: "success", svg: '<svg data-diagram="new"></svg>' });
    await render("flowchart LR\nA-->B");

    appearance.theme = "dark";
    await render("flowchart LR\nA-->B");
    first.resolve({ status: "success", svg: '<svg data-diagram="old"></svg>' });
    await wait_for_condition(() => container.querySelector('[data-diagram="new"]') !== null);

    expect(container.querySelector('[data-diagram="old"]')).toBeNull();
    expect(request).toHaveBeenLastCalledWith("flowchart LR\nA-->B", "dark");
  });

  it("渲染失败时保留归一化后的 Mermaid 源码", async () => {
    request.mockResolvedValue({ status: "error", code: "parse_failed" });
    await render("\uFEFFflowchart LR\r\nA-->B\r\n");
    await wait_for_condition(() => container.querySelector("code.language-mermaid") !== null);

    expect(container.textContent).toContain("agent_page.diagram.render_failed");
    expect(container.querySelector("code.language-mermaid")?.textContent).toBe(
      "flowchart LR\nA-->B",
    );
  });
});

/** 控制旧渲染请求的完成时机，证明过期结果不会覆盖当前图表。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve_promise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolve_promise = resolve;
  });
  return { promise, resolve: (value) => resolve_promise?.(value) };
}

/** 仅推进微任务队列，避免用固定延时猜测组件状态何时提交。 */
async function wait_for_condition(predicate: () => boolean, attempts = 30): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await act(async () => Promise.resolve());
  }
  throw new Error("等待 Mermaid 视图状态收敛失败。");
}
