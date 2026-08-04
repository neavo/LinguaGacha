import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentAssistantMessagePart,
  AgentEntry,
  AgentEntryStatus,
  AgentToolEntry,
} from "@shared/agent";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "agent_page.thinking_active") return "正在思考";
      if (key === "agent_page.status.running") return "正在处理";
      if (key === "agent_page.status.success") return "已完成";
      if (key === "agent_page.status.error") return "失败";
      if (key === "agent_page.status.stopped") return "已停止";
      return params === undefined ? key : `${key}:${Object.values(params).join(",")}`;
    },
  }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { AgentTimeline } from "./agent-timeline";

describe("AgentTimeline", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const on_follow_hold_change = vi.fn();

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    vi.useRealTimers();
    container?.remove();
    root = null;
    container = null;
    on_follow_hold_change.mockReset();
  });

  /** 复用同一 root，确保详情开合、滚动位置和自动收缩状态跨增量保留。 */
  async function render_timeline(
    entries: readonly AgentEntry[],
    resume_revision = 0,
  ): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () =>
      root?.render(
        <AgentTimeline
          entries={entries}
          resume_revision={resume_revision}
          on_follow_hold_change={on_follow_hold_change}
        />,
      ),
    );
    return container;
  }

  it("渲染流式 Markdown、空 parts 与会话活动灯", async () => {
    const view = await render_timeline([
      assistant_entry("assistant-1", "**变更方案**", "running", 1),
    ]);
    expect(view.querySelector("strong")?.textContent).toBe("变更方案");
    expect(view.querySelector(".agent-message__cursor")).toBeNull();
    expect(view.querySelector(".agent-message__activity")).toBe(
      view.querySelector(".agent-page__messages")?.lastElementChild,
    );

    await render_timeline([assistant_parts_entry("assistant-empty", [], "running", 2)]);
    expect(view.querySelector(".agent-message--assistant")).toBeNull();
    expect(
      view
        .querySelector(".agent-message__activity .agent-status-mark--running")
        ?.getAttribute("aria-label"),
    ).toBe("正在处理");

    await render_timeline([]);
    expect(view.querySelector(".agent-message__activity")).toBeNull();
  });

  it("运行工具逐秒计时，完成后保留用户展开状态并挂载输出", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_001);
    const view = await render_timeline([tool_entry("tool-1", "query_items", "running", null, 1)]);
    const tool = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--tool");
    expect(tool?.querySelector("summary")?.textContent).toBe("query_items · 8s");
    expect(tool?.querySelector('[role="timer"]')?.getAttribute("aria-live")).toBe("off");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(tool?.querySelector("summary")?.textContent).toBe("query_items · 9s");
    await act(async () => tool?.querySelector("summary")?.click());
    expect(tool?.querySelector("pre")).toBeNull();

    await render_timeline([tool_entry("tool-1", "query_items", "success", "{}", 1)]);
    expect(tool?.open).toBe(true);
    expect(tool?.querySelector("summary")?.textContent).toBe("query_items");
    const output = tool?.querySelector<HTMLPreElement>("pre");
    expect(output?.textContent).toBe("{}");
    expect(tool?.querySelector(".agent-status-mark--success")).not.toBeNull();
    if (output === undefined || output === null) throw new Error("缺少工具输出");
    Object.defineProperties(output, {
      scrollHeight: { configurable: true, value: 480 },
      clientHeight: { configurable: true, value: 240 },
      scrollTop: { configurable: true, value: 80, writable: true },
    });
    await act(async () => output.dispatchEvent(new Event("scroll")));
    expect(on_follow_hold_change).toHaveBeenLastCalledWith("tool:tool-1", true);
    await act(async () => tool?.querySelector("summary")?.click());
    expect(on_follow_hold_change).toHaveBeenLastCalledWith("tool:tool-1", false);
  });

  it("并行工具复用无图标状态灯并保留独立状态语义", async () => {
    const view = await render_timeline([
      tool_entry("tool-running", "query_items", "running", null, 1),
      tool_entry("tool-success", "query_quality_rules", "success", "{}", 2),
      tool_entry("tool-error", "read_skill", "error", "工具不存在", 3),
      tool_entry("tool-stopped", "update_glossary_rules", "stopped", null, 4),
    ]);
    for (const [status, label] of [
      ["running", "正在处理"],
      ["success", "已完成"],
      ["error", "失败"],
      ["stopped", "已停止"],
    ] as const) {
      const mark = view.querySelector<HTMLElement>(
        `.agent-detail-entry--tool .agent-status-mark--${status}[role="img"]`,
      );
      expect(mark?.getAttribute("aria-label")).toBe(label);
      expect(mark?.childElementCount).toBe(0);
    }
  });

  it("轮次运行时更新耗时，结束后冻结并保持紧凑格式", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(45_295_000);
    const view = await render_timeline([
      user_entry("user-1", [{ kind: "text", text: "开始" }], "running", 0, null),
    ]);
    const timer = view.querySelector<HTMLElement>('[role="timer"]');
    if (timer === null) throw new Error("缺少轮次计时器");
    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 55s");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 56s");

    await render_timeline([
      user_entry("user-1", [{ kind: "text", text: "开始" }], "success", 0, 45_296_000),
      user_entry("user-2", [{ kind: "text", text: "长任务" }], "stopped", 10_000, 738_000),
    ]);
    expect(
      [...view.querySelectorAll<HTMLElement>('[role="timer"]')].map((entry) => entry.textContent),
    ).toEqual(["agent_page.round.success:12h 34m 56s", "agent_page.round.stopped:12m 08s"]);
    await act(async () => vi.advanceTimersByTime(3_600_000));
    expect(timer.textContent).toBe("agent_page.round.success:12h 34m 56s");
  });

  it("流式思考只在底端自动跟随，用户上划后保持位置并可回到底端恢复", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_001);
    const render_thinking = (text: string) =>
      render_timeline([
        assistant_parts_entry("assistant-1", [{ kind: "thinking", text }], "running", 1),
      ]);
    const view = await render_thinking("检查术语\n逐项核对");
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    const content = thinking?.querySelector<HTMLPreElement>("pre");
    if (thinking === null || content === null || content === undefined) {
      throw new Error("缺少思考块");
    }
    expect(thinking.open).toBe(true);
    expect(thinking.querySelector("summary")?.textContent).toBe("正在思考 · 8s");
    let scroll_height = 480;
    let scroll_top = 240;
    Object.defineProperties(content, {
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, get: () => scroll_height },
      scrollTop: {
        configurable: true,
        get: () => scroll_top,
        set: (value: number) => {
          scroll_top = Math.min(value, scroll_height - 240);
        },
      },
    });

    scroll_height = 560;
    await render_thinking("检查术语\n逐项核对完成");
    expect(view.querySelector("pre")).toBe(content);
    expect(content.textContent).toBe("检查术语\n逐项核对完成");
    expect(thinking.open).toBe(true);
    expect(on_follow_hold_change).not.toHaveBeenCalledWith("thinking:assistant-1-0", true);
    expect(content.scrollTop).toBe(320);

    content.scrollTop = 80;
    await act(async () => content.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(on_follow_hold_change).toHaveBeenLastCalledWith("thinking:assistant-1-0", true);
    scroll_height = 640;
    await render_thinking("检查术语\n逐项核对完成\n继续检查语境");
    expect(content.scrollTop).toBe(80);

    content.scrollTop = 400;
    await act(async () => content.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(on_follow_hold_change).toHaveBeenLastCalledWith("thinking:assistant-1-0", false);
    scroll_height = 720;
    await render_thinking("检查术语\n逐项核对完成\n继续检查语境\n确认结果");
    expect(content.scrollTop).toBe(480);
  });

  it("未手动操作的思考结束三秒后关闭但保留可动画内容", async () => {
    vi.useFakeTimers();
    const view = await render_timeline([
      assistant_parts_entry("assistant-1", [{ kind: "thinking", text: "检查术语" }], "running", 1),
    ]);
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    if (thinking === null) throw new Error("缺少思考块");

    await render_timeline([
      assistant_parts_entry(
        "assistant-1",
        [
          { kind: "thinking", text: "检查术语完成" },
          { kind: "text", text: "**结论**" },
        ],
        "running",
        1,
      ),
    ]);
    await act(async () => vi.advanceTimersByTime(2_999));
    expect(thinking.open).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(thinking.open).toBe(false);
    expect(thinking.querySelector("pre")?.textContent).toBe("检查术语完成");
    expect(view.querySelector("strong")?.textContent).toBe("结论");
  });

  it("完成后离底会暂停自动收缩，回到底端后重新计时", async () => {
    vi.useFakeTimers();
    const view = await render_timeline([
      assistant_parts_entry("assistant-1", [{ kind: "thinking", text: "检查术语" }], "running", 1),
    ]);
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    const content = thinking?.querySelector<HTMLPreElement>("pre");
    if (thinking === null || content === null || content === undefined) {
      throw new Error("缺少思考块");
    }
    Object.defineProperties(content, {
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, value: 480 },
      scrollTop: { configurable: true, value: 240, writable: true },
    });

    await render_timeline([
      assistant_parts_entry(
        "assistant-1",
        [
          { kind: "thinking", text: "检查术语完成" },
          { kind: "text", text: "完成" },
        ],
        "running",
        1,
      ),
    ]);
    await act(async () => vi.advanceTimersByTime(1_000));
    content.scrollTop = 80;
    await act(async () => content.dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(thinking.open).toBe(true);

    content.scrollTop = 240;
    await act(async () => content.dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(2_999));
    expect(thinking.open).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(thinking.open).toBe(false);
  });

  it("用户手动开合优先且历史思考不启动自动收缩", async () => {
    vi.useFakeTimers();
    const view = await render_timeline([
      assistant_parts_entry(
        "assistant-manual",
        [{ kind: "thinking", text: "人工检查" }],
        "running",
        1,
      ),
    ]);
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    if (thinking === null) throw new Error("缺少思考块");
    await act(async () => thinking.querySelector("summary")?.click());

    await render_timeline([
      assistant_parts_entry(
        "assistant-manual",
        [
          { kind: "thinking", text: "人工检查完成" },
          { kind: "text", text: "完成" },
        ],
        "running",
        1,
      ),
    ]);
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(thinking.open).toBe(false);
    await act(async () => thinking.querySelector("summary")?.click());
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(thinking.open).toBe(true);

    await render_timeline([
      assistant_parts_entry(
        "assistant-history",
        [{ kind: "thinking", text: "历史思考" }],
        "success",
        2,
      ),
    ]);
    const history = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    if (history === null) throw new Error("缺少历史思考块");
    expect(history.open).toBe(false);
    expect(history.querySelector("pre")?.textContent).toBe("历史思考");
    await act(async () => history.querySelector("summary")?.click());
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(history.open).toBe(true);
  });

  it("按后端顺序渲染工具并只在展开时挂载完整输出", async () => {
    const view = await render_timeline([
      user_entry(
        "user-1",
        [
          { kind: "text", text: "请用 " },
          { kind: "skill", name: "glossary-audit" },
          { kind: "text", text: "\n查询" },
        ],
        "success",
        0,
        2_000,
      ),
      assistant_entry("assistant-1", "准备查询", "success", 1000),
      tool_entry(
        "tool-1",
        "query_items",
        "success",
        '{"items":[{"item_id":1,"src":"Alice"}]}',
        1500,
      ),
      tool_entry("tool-2", "read_skill", "error", "工具不存在", 1800),
      assistant_entry("assistant-2", "查询完成", "success", 2000),
    ]);
    const visible_text = view.textContent ?? "";
    expect(visible_text.indexOf("准备查询")).toBeLessThan(visible_text.indexOf("query_items"));
    expect(visible_text.indexOf("query_items")).toBeLessThan(visible_text.indexOf("read_skill"));
    const tools = view.querySelectorAll<HTMLDetailsElement>(".agent-detail-entry--tool");
    expect([...tools].every((tool) => !tool.open)).toBe(true);
    expect(tools[0]?.textContent).not.toContain("Alice");
    expect(tools[1]?.querySelector(".agent-status-mark--error")?.getAttribute("aria-label")).toBe(
      "失败",
    );
    await act(async () => tools[0]?.querySelector("summary")?.click());
    expect(tools[0]?.querySelector("pre")?.textContent).toContain('"src": "Alice"');
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
  status: AgentEntryStatus,
  createdAt: number,
  endedAt: number | null,
) {
  return {
    kind: "user_message" as const,
    id,
    parts,
    status,
    createdAt,
    endedAt,
  };
}

function assistant_entry(id: string, text: string, status: AgentEntryStatus, createdAt: number) {
  return assistant_parts_entry(id, [{ kind: "text", text }], status, createdAt);
}

function assistant_parts_entry(
  id: string,
  parts: AgentAssistantMessagePart[],
  status: AgentEntryStatus,
  createdAt: number,
) {
  return {
    kind: "assistant_message" as const,
    id,
    parts,
    status,
    createdAt,
  };
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
