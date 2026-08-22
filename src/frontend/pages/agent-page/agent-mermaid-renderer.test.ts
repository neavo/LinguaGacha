import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaid_mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid_mocks }));

import { mermaid_renderer, normalize_mermaid_source } from "./agent-mermaid-renderer";

describe("MermaidRenderer", () => {
  beforeEach(() => {
    mermaid_mocks.initialize.mockReset();
    mermaid_mocks.parse.mockReset();
    mermaid_mocks.render.mockReset();
    set_theme_tokens();
  });

  it("归一化带引号连线标签的分隔空白并通过真实 Mermaid 预检", async () => {
    const actual_mermaid = (await vi.importActual<typeof import("mermaid")>("mermaid")).default;
    actual_mermaid.initialize({ startOnLoad: false });
    const source = `flowchart TD
A["收到请求"] --> B{"信息是否完整"}
B -->| "是" | C["执行任务"]
B --> | "否" | D["请求补充"]`;
    const normalized_source = normalize_mermaid_source(source);

    expect(normalized_source).toBe(`flowchart TD
A["收到请求"] --> B{"信息是否完整"}
B -->|"是"| C["执行任务"]
B -->|"否"| D["请求补充"]`);
    expect(normalize_mermaid_source(normalized_source)).toBe(normalized_source);
    await expect(
      actual_mermaid.parse(normalized_source, { suppressErrors: true }),
    ).resolves.not.toBe(false);
  });

  it("合并相同请求、复用成功结果并串行切换主题配置", async () => {
    const first_render = deferred<{ svg: string }>();
    mermaid_mocks.parse.mockResolvedValue({ diagramType: "flowchart" });
    mermaid_mocks.render
      .mockImplementationOnce(() => first_render.promise)
      .mockResolvedValueOnce({ svg: '<svg data-theme="dark"></svg>' });

    const first = mermaid_renderer.request("flowchart LR\nA-->B", "light");
    const duplicate = mermaid_renderer.request("flowchart LR\nA-->B", "light");
    const dark = mermaid_renderer.request("flowchart LR\nA-->C", "dark");
    expect(duplicate).toBe(first);
    await wait_for_condition(() => mermaid_mocks.render.mock.calls.length === 1);
    expect(mermaid_mocks.initialize).toHaveBeenCalledTimes(1);

    first_render.resolve({ svg: '<svg data-theme="light"></svg>' });
    await expect(first).resolves.toEqual({
      status: "success",
      svg: '<svg data-theme="light"></svg>',
    });
    await expect(duplicate).resolves.toEqual({
      status: "success",
      svg: '<svg data-theme="light"></svg>',
    });
    await expect(dark).resolves.toEqual({
      status: "success",
      svg: '<svg data-theme="dark"></svg>',
    });

    expect(mermaid_mocks.initialize.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        securityLevel: "strict",
        themeVariables: expect.objectContaining({ darkMode: true }),
      }),
    );
    await expect(mermaid_renderer.request("flowchart LR\nA-->B", "light")).resolves.toEqual({
      status: "success",
      svg: '<svg data-theme="light"></svg>',
    });
    expect(mermaid_mocks.render).toHaveBeenCalledTimes(2);
  });

  it("语法预检失败时返回可区分错误且不进入渲染", async () => {
    mermaid_mocks.parse.mockResolvedValue(false);

    await expect(mermaid_renderer.request("invalid parse", "light")).resolves.toEqual({
      status: "error",
      code: "parse_failed",
    });
    expect(mermaid_mocks.render).not.toHaveBeenCalled();
  });

  it("渲染异常时收敛为稳定错误结果", async () => {
    mermaid_mocks.parse.mockResolvedValue({ diagramType: "flowchart" });
    mermaid_mocks.render.mockRejectedValue(new Error("渲染失败"));

    await expect(mermaid_renderer.request("invalid render", "light")).resolves.toEqual({
      status: "error",
      code: "render_failed",
    });
  });
});

/** 为主题配置提供稳定的应用设计令牌，不锁定具体配色策略。 */
function set_theme_tokens(): void {
  const style = document.documentElement.style;
  for (const name of [
    "--popover",
    "--muted",
    "--foreground",
    "--border",
    "--accent",
    "--secondary",
    "--muted-foreground",
  ]) {
    style.setProperty(name, name);
  }
}

/** 控制首张图的完成时机，证明主题配置不会越过正在渲染的任务。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve_promise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolve_promise = resolve;
  });
  return { promise, resolve: (value) => resolve_promise?.(value) };
}

/** 只推进微任务，等待动态导入和串行队列进入可观察状态。 */
async function wait_for_condition(predicate: () => boolean, attempts = 30): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("等待 Mermaid 渲染队列失败。");
}
