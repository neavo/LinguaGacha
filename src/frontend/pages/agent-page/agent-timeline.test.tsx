import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentAssistantMessagePart,
  AgentEntry,
  AgentSessionState,
  AgentToolEntry,
} from "@shared/agent";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "agent_page.thinking_active") return "正在思考";
      if (key === "agent_page.status.running") return "正在处理";
      if (key === "agent_page.status.success") return "已完成";
      if (key === "agent_page.status.error") return "失败";
      return params === undefined ? key : `${key}:${Object.values(params).join(",")}`;
    },
  }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { AgentTimeline } from "./agent-timeline";

describe("AgentTimeline", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    vi.useRealTimers();
    container?.remove();
    root = null;
    container = null;
  });

  async function render_timeline(
    entries: readonly AgentEntry[],
    state: AgentSessionState = "idle",
  ): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<AgentTimeline entries={entries} state={state} />));
    return container;
  }

  it("渲染流式 Markdown、空 parts 与会话活动灯", async () => {
    const view = await render_timeline(
      [assistant_entry("assistant-1", "**变更方案**", false, 1)],
      "running",
    );
    expect(view.querySelector("strong")?.textContent).toBe("变更方案");
    expect(view.querySelector(".agent-message__cursor")).toBeNull();
    expect(view.querySelector(".agent-message__activity")).toBe(
      view.querySelector(".agent-page__messages")?.lastElementChild,
    );

    await render_timeline([assistant_parts_entry("assistant-empty", [], false, 2)], "running");
    expect(view.querySelector(".agent-message--assistant")).toBeNull();
    expect(
      view
        .querySelector(".agent-message__activity .agent-status-light--active")
        ?.getAttribute("aria-label"),
    ).toBe("正在处理");

    await render_timeline([], "complete");
    expect(view.querySelector(".agent-message__activity")).toBeNull();
  });

  it("运行工具逐秒计时，完成后保留用户展开状态并挂载输出", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_001);
    const view = await render_timeline(
      [tool_entry("tool-1", "query_project_items", "running", null, 1)],
      "running",
    );
    const tool = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--tool");
    expect(tool?.querySelector("summary")?.textContent).toBe("query_project_items · 8s");
    expect(tool?.querySelector('[role="timer"]')?.getAttribute("aria-live")).toBe("off");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(tool?.querySelector("summary")?.textContent).toBe("query_project_items · 9s");
    await act(async () => tool?.querySelector("summary")?.click());
    expect(tool?.querySelector("pre")).toBeNull();

    await render_timeline(
      [tool_entry("tool-1", "query_project_items", "success", "{}", 1)],
      "running",
    );
    expect(tool?.open).toBe(true);
    expect(tool?.querySelector("summary")?.textContent).toBe("query_project_items");
    expect(tool?.querySelector("pre")?.textContent).toBe("{}");
    expect(tool?.querySelector(".agent-status-light--success")).not.toBeNull();
  });

  it("并行工具乱序完成后仍为未完成项保留计时和状态", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_001);
    const view = await render_timeline(
      [
        tool_entry("tool-running", "query_project_items", "running", null, 1),
        tool_entry("tool-complete", "query_quality_rules", "success", "{}", 2),
      ],
      "running",
    );
    const tools = view.querySelectorAll<HTMLDetailsElement>(".agent-detail-entry--tool");
    expect(tools[0]?.querySelector(".agent-detail-entry__label")?.textContent).toBe(
      "query_project_items · 8s",
    );
    expect(tools[0]?.querySelector(".agent-status-light--active")).not.toBeNull();
    expect(tools[1]?.querySelector(".agent-detail-entry__label")?.textContent).toBe(
      "query_quality_rules",
    );
    expect(tools[1]?.querySelector(".agent-status-light--success")).not.toBeNull();
  });

  it("轮次运行时更新耗时，结束后冻结并保持紧凑格式", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(45_295_000);
    const view = await render_timeline(
      [user_entry("user-1", [{ kind: "text", text: "开始" }], 0, null)],
      "running",
    );
    const timer = view.querySelector<HTMLElement>('[role="timer"]');
    if (timer === null) throw new Error("缺少轮次计时器");
    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 55s");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 56s");

    await render_timeline(
      [
        user_entry("user-1", [{ kind: "text", text: "开始" }], 0, 45_296_000),
        user_entry("user-2", [{ kind: "text", text: "长任务" }], 10_000, 738_000),
      ],
      "complete",
    );
    expect(
      [...view.querySelectorAll<HTMLElement>('[role="timer"]')].map((entry) => entry.textContent),
    ).toEqual(["agent_page.round.ended:12h 34m 56s", "agent_page.round.ended:12m 08s"]);
    await act(async () => vi.advanceTimersByTime(3_600_000));
    expect(timer.textContent).toBe("agent_page.round.ended:12h 34m 56s");
  });

  it("流式思考默认展开并在内容增长时把内部滚动保持在末尾", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_001);
    const view = await render_timeline(
      [
        assistant_parts_entry(
          "assistant-1",
          [{ kind: "thinking", text: "检查术语\n逐项核对" }],
          false,
          1,
        ),
      ],
      "running",
    );
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    const content = thinking?.querySelector<HTMLPreElement>("pre");
    if (thinking === null || content === null || content === undefined) {
      throw new Error("缺少思考块");
    }
    expect(thinking.open).toBe(true);
    expect(thinking.querySelector("summary")?.textContent).toBe("正在思考 · 8s");
    Object.defineProperties(content, {
      scrollHeight: { configurable: true, value: 480 },
      scrollTop: { configurable: true, value: 12, writable: true },
    });

    await render_timeline(
      [
        assistant_parts_entry(
          "assistant-1",
          [{ kind: "thinking", text: "检查术语\n逐项核对完成" }],
          false,
          1,
        ),
      ],
      "running",
    );
    expect(content.textContent).toBe("检查术语\n逐项核对完成");
    expect(content.scrollTop).toBe(480);
  });

  it("未手动操作的思考结束三秒后关闭但保留可动画内容", async () => {
    vi.useFakeTimers();
    const view = await render_timeline(
      [assistant_parts_entry("assistant-1", [{ kind: "thinking", text: "检查术语" }], false, 1)],
      "running",
    );
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    if (thinking === null) throw new Error("缺少思考块");

    await render_timeline(
      [
        assistant_parts_entry(
          "assistant-1",
          [
            { kind: "thinking", text: "检查术语完成" },
            { kind: "text", text: "**结论**" },
          ],
          false,
          1,
        ),
      ],
      "running",
    );
    await act(async () => vi.advanceTimersByTime(2_999));
    expect(thinking.open).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(thinking.open).toBe(false);
    expect(thinking.querySelector("pre")?.textContent).toBe("检查术语完成");
    expect(view.querySelector("strong")?.textContent).toBe("结论");
  });

  it("用户手动选择优先且历史思考不启动自动收缩", async () => {
    vi.useFakeTimers();
    const view = await render_timeline(
      [
        assistant_parts_entry(
          "assistant-manual",
          [{ kind: "thinking", text: "人工检查" }],
          false,
          1,
        ),
      ],
      "running",
    );
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    if (thinking === null) throw new Error("缺少思考块");
    await act(async () => thinking.querySelector("summary")?.click());

    await render_timeline(
      [
        assistant_parts_entry(
          "assistant-manual",
          [
            { kind: "thinking", text: "人工检查完成" },
            { kind: "text", text: "完成" },
          ],
          false,
          1,
        ),
      ],
      "running",
    );
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(thinking.open).toBe(false);
    await act(async () => thinking.querySelector("summary")?.click());
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(thinking.open).toBe(true);

    await render_timeline(
      [
        assistant_parts_entry(
          "assistant-history",
          [{ kind: "thinking", text: "历史思考" }],
          true,
          2,
        ),
      ],
      "complete",
    );
    const history = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    if (history === null) throw new Error("缺少历史思考块");
    expect(history.open).toBe(false);
    expect(history.querySelector("pre")?.textContent).toBe("历史思考");
    await act(async () => history.querySelector("summary")?.click());
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(history.open).toBe(true);
  });

  it("按后端顺序渲染工具并只在展开时挂载完整输出", async () => {
    const view = await render_timeline(
      [
        user_entry(
          "user-1",
          [
            { kind: "text", text: "请用 " },
            { kind: "skill", name: "glossary-audit" },
            { kind: "text", text: "\n查询" },
          ],
          0,
          2_000,
        ),
        assistant_entry("assistant-1", "准备查询", true, 1000),
        tool_entry(
          "tool-1",
          "query_project_items",
          "success",
          '{"results":[{"pattern":"Alice","contexts":[]}]}',
          1500,
        ),
        tool_entry("tool-2", "read_skill", "error", "工具不存在", 1800),
        assistant_entry("assistant-2", "查询完成", true, 2000),
      ],
      "complete",
    );
    const visible_text = view.textContent ?? "";
    expect(visible_text.indexOf("准备查询")).toBeLessThan(
      visible_text.indexOf("query_project_items"),
    );
    expect(visible_text.indexOf("query_project_items")).toBeLessThan(
      visible_text.indexOf("read_skill"),
    );
    const tools = view.querySelectorAll<HTMLDetailsElement>(".agent-detail-entry--tool");
    expect([...tools].every((tool) => !tool.open)).toBe(true);
    expect(tools[0]?.textContent).not.toContain("Alice");
    expect(tools[1]?.querySelector(".agent-status-light--error")?.getAttribute("aria-label")).toBe(
      "失败",
    );
    await act(async () => tools[0]?.querySelector("summary")?.click());
    expect(tools[0]?.querySelector("pre")?.textContent).toContain('"pattern": "Alice"');
    expect(tools[1]?.querySelector("pre")).toBeNull();
    await act(async () => tools[0]?.querySelector("summary")?.click());
    expect(tools[0]?.querySelector("pre")).toBeNull();
    expect(view.querySelector(".agent-message__user-text")?.textContent).toBe(
      "请用 @glossary-audit\n查询",
    );
    expect(view.querySelector(".agent-round-header")?.textContent).toContain("2s");
  });
});

function user_entry(
  id: string,
  parts: Array<{ kind: "text"; text: string } | { kind: "skill"; name: string }>,
  createdAt: number,
  endedAt: number | null,
) {
  return { kind: "user_message" as const, id, parts, createdAt, endedAt };
}

function assistant_entry(id: string, text: string, complete: boolean, createdAt: number) {
  return assistant_parts_entry(id, [{ kind: "text", text }], complete, createdAt);
}

function assistant_parts_entry(
  id: string,
  parts: AgentAssistantMessagePart[],
  complete: boolean,
  createdAt: number,
) {
  return { kind: "assistant_message" as const, id, parts, complete, createdAt };
}

function tool_entry(
  id: string,
  toolName: string,
  status: AgentToolEntry["status"],
  output: string | null,
  createdAt: number,
): AgentToolEntry {
  return { kind: "tool_call", id, toolName, status, output, createdAt };
}
