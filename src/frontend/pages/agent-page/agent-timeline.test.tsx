import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentAssistantMessagePart,
  AgentContextCompactionEntry,
  AgentEntry,
  AgentEntryStatus,
  AgentToolEntry,
} from "@shared/agent";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "agent_page.thinking_active") return "正在思考";
      if (key === "agent_page.status.running") return "正在处理";
      if (key === "agent_page.status.success") return "已完成";
      if (key === "agent_page.status.error") return "失败";
      if (key === "agent_page.status.stopped") return "已停止";
      if (key === "agent_page.action.retry") return "重试";
      if (key === "agent_page.action.click_to_retry") return "点击重试";
      if (key === "agent_page.compaction.running") return "正在压缩上下文 …";
      if (key === "agent_page.compaction.success") return "上下文压缩成功";
      if (key === "agent_page.compaction.error") return "上下文压缩失败";
      if (key === "app.error.model.provider_failed.message") return "模型服务请求失败。";
      return params === undefined ? key : `${key}:${Object.values(params).join(",")}`;
    },
  }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { AgentTimeline } from "./agent-timeline";
import { create_agent_mention_tokens } from "./agent-mention";

const MENTION_TOKENS = create_agent_mention_tokens(
  [
    {
      name: "glossary-audit",
      displayDescriptions: { "zh-CN": "", "en-US": "", "de-DE": "" },
    },
  ],
  [{ src: "Alice", dst: "爱丽丝", info: "", case_sensitive: false }],
);

describe("AgentTimeline", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const on_follow_hold_change = vi.fn();
  const on_retry = vi.fn();
  const on_compaction_retry = vi.fn();

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    vi.useRealTimers();
    container?.remove();
    root = null;
    container = null;
    on_follow_hold_change.mockReset();
    on_retry.mockReset();
    on_compaction_retry.mockReset();
  });

  /** 复用同一 root，确保模态选择和思考详情状态跨增量保留。 */
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
        <TooltipProvider>
          <AgentTimeline
            entries={entries}
            mention_tokens={MENTION_TOKENS}
            resume_revision={resume_revision}
            on_follow_hold_change={on_follow_hold_change}
            on_retry={on_retry}
            on_compaction_retry={on_compaction_retry}
            message_retry_disabled={false}
            compaction_retry_disabled={false}
          />
        </TooltipProvider>,
      ),
    );
    return container;
  }

  function get_tool_dialog_text(): string | undefined {
    return document.body.querySelector('[role="dialog"] .cm-content')?.textContent ?? undefined;
  }

  function get_tool_dialog_json(): unknown {
    return JSON.parse(get_tool_dialog_text() ?? "");
  }

  it("渲染流式 Markdown、空 parts 与运行轮次尾标", async () => {
    const view = await render_timeline(
      round_entries([assistant_entry("assistant-1", "**变更方案**", "running", 1)]),
    );
    expect(view.querySelector("strong")?.textContent).toBe("变更方案");
    expect(view.querySelector(".agent-message__cursor")).toBeNull();
    const footer = view.querySelector<HTMLElement>(".agent-round-footer");
    expect(footer).toBe(view.querySelector(".agent-page__messages")?.lastElementChild);
    expect(footer?.dataset["running"]).toBe("true");
    expect(footer?.querySelector(".agent-round-footer__running")?.getAttribute("aria-hidden")).toBe(
      "false",
    );
    expect(footer?.querySelector(".agent-round-footer__result")?.getAttribute("aria-hidden")).toBe(
      "true",
    );

    await render_timeline(
      round_entries([assistant_parts_entry("assistant-empty", [], "running", 2)]),
    );
    expect(view.querySelector(".agent-message--assistant")).toBeNull();
    expect(view.querySelector(".agent-round-footer__running")?.getAttribute("aria-hidden")).toBe(
      "false",
    );
    expect(view.querySelector(".agent-round-footer")?.textContent).toContain(
      "agent_page.round.running",
    );

    await render_timeline([]);
    expect(view.querySelector(".agent-round-footer")).toBeNull();
  });

  it("用户消息把已知能力与术语显示为整块，未知 marker 保持普通文本", async () => {
    const view = await render_timeline([
      user_entry("user-1", "@term(Alice)", "success", 0, 1_000),
      user_entry(
        "user-2",
        "使用 @skill(glossary-audit) 和 @term(Unknown)",
        "success",
        2_000,
        3_000,
      ),
    ]);
    const messages = view.querySelectorAll<HTMLElement>(".agent-message--user");

    expect(messages[0]?.dataset["mentionOnly"]).toBe("true");
    expect(
      [...view.querySelectorAll<HTMLElement>(".agent-mention-token > span")].map(
        (token) => token.textContent,
      ),
    ).toEqual(["@term(Alice)", "@skill(glossary-audit)"]);
    expect(messages[1]?.textContent).toContain("@term(Unknown)");
  });

  it("渲染纯图片和多图片消息而不生成空文本段落", async () => {
    const view = await render_timeline([
      user_entry("user-images", "", "success", 0, 1_000, ["webp-a", "webp-b"]),
    ]);

    const images = view.querySelectorAll<HTMLImageElement>(".agent-message__user-images img");
    expect(images).toHaveLength(2);
    expect(images[0]?.src).toBe("data:image/webp;base64,webp-a");
    expect(images[0]?.alt).toBe("agent_page.image.message:1");
    expect(view.querySelector(".agent-message__user-text")).toBeNull();
  });

  it("失败恢复条目位于所属轮次末尾且整块点击回传原消息", async () => {
    const view = await render_timeline([
      user_entry("user-error", "重新检查术语", "error", 0, 2_000),
      assistant_entry("assistant-error", "部分结果", "error", 1_000),
      user_entry("user-next", "继续", "success", 3_000, 4_000),
    ]);
    const assistant = view.querySelector(".agent-message--assistant");
    const error = view.querySelector<HTMLButtonElement>(".agent-retry-entry");
    const first_footer = view.querySelector(".agent-round-footer");
    const next_user = view.querySelectorAll(".agent-message--user")[1];
    if (assistant === null || error === null || first_footer === null || next_user === undefined) {
      throw new Error("缺少失败轮次结构");
    }

    expect(assistant.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(error.compareDocumentPosition(first_footer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    expect(
      first_footer.compareDocumentPosition(next_user) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(error.textContent).toContain("模型服务请求失败。");
    expect(error.textContent).toContain("点击重试");
    expect(error.querySelectorAll("svg")).toHaveLength(1);
    await act(async () => error.click());
    expect(on_retry).toHaveBeenCalledWith({ text: "重新检查术语", images: [] });
  });

  it("压缩三态原位覆盖，失败时只开放压缩重试", async () => {
    const round = [
      user_entry("user-error", "继续检查", "error", 0, 2_000),
      assistant_entry("assistant-error", "部分结果", "error", 1_000),
    ];
    const view = await render_timeline([
      ...round,
      compaction_entry("compaction-1", "running", 1_500),
    ]);
    expect(view.querySelector(".agent-context-compaction")?.textContent).toContain(
      "正在压缩上下文 …",
    );
    expect(view.querySelector(".agent-round-footer[data-running]")).toBeNull();

    await render_timeline([...round, compaction_entry("compaction-1", "error", 1_500)]);
    const retry = view.querySelector<HTMLButtonElement>(".agent-retry-entry");
    expect(retry?.textContent).toContain("上下文压缩失败");
    expect(retry?.textContent).toContain("点击重试");
    expect(retry?.querySelectorAll("svg")).toHaveLength(1);
    await act(async () => retry?.click());
    expect(on_compaction_retry).toHaveBeenCalledOnce();

    await render_timeline([...round, compaction_entry("compaction-1", "success", 1_500)]);
    expect(view.querySelector(".agent-context-compaction")?.textContent).toContain(
      "上下文压缩成功",
    );
    expect(view.querySelector(".agent-retry-entry")).toBeNull();
  });

  it("运行工具逐秒计时，模态按同 id 更新且不抢切输出", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_001);
    const view = await render_timeline(
      round_entries([
        tool_entry("tool-1", "workspace_script", "running", null, 1, '{"scope":"input"}'),
      ]),
    );
    const tool = view.querySelector<HTMLButtonElement>(".agent-tool-entry");
    expect(tool?.textContent).toBe("workspace_script · 8s");
    expect(tool?.querySelector('[role="timer"]')?.getAttribute("aria-live")).toBe("off");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(tool?.textContent).toBe("workspace_script · 9s");
    await act(async () => tool?.click());
    expect(get_tool_dialog_json()).toEqual({ scope: "input" });

    await render_timeline(
      round_entries(
        [
          tool_entry(
            "tool-1",
            "workspace_script",
            "success",
            '{"scope":"output"}',
            1,
            '{"scope":"input"}',
          ),
        ],
        "success",
      ),
    );
    expect(get_tool_dialog_json()).toEqual({ scope: "input" });
    const output_tab = [
      ...document.body.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
    ].find((button) => button.textContent === "agent_page.tool.output");
    await act(async () =>
      output_tab?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }),
      ),
    );
    expect(get_tool_dialog_json()).toEqual({ scope: "output" });
    expect(view.querySelector(".agent-tool-entry .agent-status-mark--success")).not.toBeNull();
    expect(on_follow_hold_change).not.toHaveBeenCalled();
  });

  it("并行工具复用无图标状态灯并保留独立状态语义", async () => {
    const view = await render_timeline(
      round_entries([
        tool_entry("tool-running", "workspace_script", "running", null, 1),
        tool_entry("tool-success", "workspace_create", "success", "{}", 2),
        tool_entry("tool-error", "read_skill", "error", "工具不存在", 3),
        tool_entry("tool-stopped", "workspace_apply", "stopped", null, 4),
      ]),
    );
    for (const [status, label] of [
      ["running", "正在处理"],
      ["success", "已完成"],
      ["error", "失败"],
      ["stopped", "已停止"],
    ] as const) {
      const mark = view.querySelector<HTMLElement>(
        `.agent-tool-entry .agent-status-mark--${status}[role="img"]`,
      );
      expect(mark?.getAttribute("aria-label")).toBe(label);
      expect(mark?.childElementCount).toBe(0);
    }
  });

  it("轮次运行时更新耗时，结束后冻结并保持紧凑格式", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(45_295_000);
    const view = await render_timeline([user_entry("user-1", "开始", "running", 0, null)]);
    const timer = view.querySelector<HTMLElement>('[role="timer"]');
    if (timer === null) throw new Error("缺少轮次计时器");
    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 55s");
    expect(view.querySelector<HTMLElement>(".agent-round-footer")?.dataset["running"]).toBe("true");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 56s");

    await render_timeline([
      user_entry("user-1", "开始", "success", 0, 45_296_000),
      user_entry("user-2", "长任务", "stopped", 10_000, 738_000),
    ]);
    expect(
      [...view.querySelectorAll<HTMLElement>('[role="timer"]')].map((entry) => entry.textContent),
    ).toEqual(["agent_page.round.success:12h 34m 56s", "agent_page.round.stopped:12m 08s"]);
    expect(view.querySelector(".agent-round-footer[data-running]")).toBeNull();
    expect(view.querySelector(".agent-round-footer__running")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(view.querySelector(".agent-round-footer__result")?.getAttribute("aria-hidden")).toBe(
      "false",
    );
    const completed_timer = view.querySelector<HTMLElement>('[role="timer"]');
    if (completed_timer === null) throw new Error("缺少已完成轮次计时器");
    await act(async () => vi.advanceTimersByTime(3_600_000));
    expect(completed_timer.textContent).toBe("agent_page.round.success:12h 34m 56s");
  });

  it("流式思考只在底端自动跟随，用户上划后保持位置并可回到底端恢复", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_001);
    const render_thinking = (text: string) =>
      render_timeline(
        round_entries([
          assistant_parts_entry("assistant-1", [{ kind: "thinking", text }], "running", 1),
        ]),
      );
    const view = await render_thinking("检查术语\n逐项核对");
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-thinking-entry");
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

  it("未手动操作的思考结束后自动关闭但保留可动画内容", async () => {
    vi.useFakeTimers();
    const view = await render_timeline(
      round_entries([
        assistant_parts_entry(
          "assistant-1",
          [{ kind: "thinking", text: "检查术语" }],
          "running",
          1,
        ),
      ]),
    );
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-thinking-entry");
    if (thinking === null) throw new Error("缺少思考块");

    await render_timeline(
      round_entries([
        assistant_parts_entry(
          "assistant-1",
          [
            { kind: "thinking", text: "检查术语完成" },
            { kind: "text", text: "**结论**" },
          ],
          "running",
          1,
        ),
      ]),
    );
    await act(async () => vi.runOnlyPendingTimers());
    expect(thinking.open).toBe(false);
    expect(thinking.querySelector("pre")?.textContent).toBe("检查术语完成");
    expect(view.querySelector("strong")?.textContent).toBe("结论");
  });

  it("完成后离底会暂停自动收缩，回到底端后重新计时", async () => {
    vi.useFakeTimers();
    const view = await render_timeline(
      round_entries([
        assistant_parts_entry(
          "assistant-1",
          [{ kind: "thinking", text: "检查术语" }],
          "running",
          1,
        ),
      ]),
    );
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-thinking-entry");
    const content = thinking?.querySelector<HTMLPreElement>("pre");
    if (thinking === null || content === null || content === undefined) {
      throw new Error("缺少思考块");
    }
    Object.defineProperties(content, {
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, value: 480 },
      scrollTop: { configurable: true, value: 240, writable: true },
    });

    await render_timeline(
      round_entries([
        assistant_parts_entry(
          "assistant-1",
          [
            { kind: "thinking", text: "检查术语完成" },
            { kind: "text", text: "完成" },
          ],
          "running",
          1,
        ),
      ]),
    );
    content.scrollTop = 80;
    await act(async () => content.dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () => vi.runOnlyPendingTimers());
    expect(thinking.open).toBe(true);

    content.scrollTop = 240;
    await act(async () => content.dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () => vi.runOnlyPendingTimers());
    expect(thinking.open).toBe(false);
  });

  it("用户手动开合优先且历史思考不启动自动收缩", async () => {
    vi.useFakeTimers();
    const view = await render_timeline(
      round_entries([
        assistant_parts_entry(
          "assistant-manual",
          [{ kind: "thinking", text: "人工检查" }],
          "running",
          1,
        ),
      ]),
    );
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-thinking-entry");
    if (thinking === null) throw new Error("缺少思考块");
    await act(async () => thinking.querySelector("summary")?.click());

    await render_timeline(
      round_entries([
        assistant_parts_entry(
          "assistant-manual",
          [
            { kind: "thinking", text: "人工检查完成" },
            { kind: "text", text: "完成" },
          ],
          "running",
          1,
        ),
      ]),
    );
    await act(async () => vi.runOnlyPendingTimers());
    expect(thinking.open).toBe(false);
    await act(async () => thinking.querySelector("summary")?.click());
    await act(async () => vi.runOnlyPendingTimers());
    expect(thinking.open).toBe(true);

    await render_timeline(
      round_entries(
        [
          assistant_parts_entry(
            "assistant-history",
            [{ kind: "thinking", text: "历史思考" }],
            "success",
            2,
          ),
        ],
        "success",
      ),
    );
    const history = view.querySelector<HTMLDetailsElement>(".agent-thinking-entry");
    if (history === null) throw new Error("缺少历史思考块");
    expect(history.open).toBe(false);
    expect(history.querySelector("pre")?.textContent).toBe("历史思考");
    await act(async () => history.querySelector("summary")?.click());
    await act(async () => vi.runOnlyPendingTimers());
    expect(history.open).toBe(true);
  });

  it("按后端顺序渲染工具摘要并只在唯一模态挂载当前输出", async () => {
    const view = await render_timeline([
      user_entry("user-1", "请用 @skill(glossary-audit)\n查询", "success", 0, 2_000),
      assistant_entry("assistant-1", "准备查询", "success", 1000),
      tool_entry(
        "tool-1",
        "workspace_script",
        "success",
        '{"items":[{"item_id":1,"src":"Alice"}]}',
        1500,
      ),
      tool_entry("tool-2", "read_skill", "error", "工具不存在", 1800),
      assistant_entry("assistant-2", "查询完成", "success", 2000),
    ]);
    const visible_text = view.textContent ?? "";
    expect(visible_text.indexOf("准备查询")).toBeLessThan(visible_text.indexOf("workspace_script"));
    expect(visible_text.indexOf("workspace_script")).toBeLessThan(
      visible_text.indexOf("read_skill"),
    );
    const tools = view.querySelectorAll<HTMLButtonElement>(".agent-tool-entry");
    expect(tools[0]?.textContent).not.toContain("Alice");
    expect(tools[1]?.querySelector(".agent-status-mark--error")?.getAttribute("aria-label")).toBe(
      "失败",
    );
    expect(view.querySelector("pre")).toBeNull();
    await act(async () => tools[0]?.click());
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(get_tool_dialog_text()).toContain('"src": "Alice"');
    expect(view.querySelector(".agent-message__user-text")?.textContent).toBe(
      "请用 @skill(glossary-audit)\n查询",
    );
    expect(view.querySelector(".agent-round-footer")?.textContent).toContain("2s");
  });
});

function round_entries(
  entries: readonly AgentEntry[],
  status: AgentEntryStatus = "running",
): AgentEntry[] {
  return [
    user_entry("user-current", "开始", status, 0, status === "running" ? null : 2_000),
    ...entries,
  ];
}

function user_entry(
  id: string,
  text: string,
  status: AgentEntryStatus,
  createdAt: number,
  endedAt: number | null,
  images: string[] = [],
) {
  return {
    kind: "user_message" as const,
    id,
    text,
    images,
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
  input = "{}",
): AgentToolEntry {
  const base = { kind: "tool_call" as const, id, toolName, input, createdAt };
  if (status === "running" || status === "stopped") {
    if (output !== null) throw new Error("开放或停止工具不得携带输出");
    return { ...base, status, output: null };
  }
  if (output === null) throw new Error("成功或失败工具必须携带输出");
  return { ...base, status, output };
}

function compaction_entry(
  id: string,
  status: AgentContextCompactionEntry["status"],
  createdAt: number,
): AgentContextCompactionEntry {
  return { kind: "context_compaction", id, status, createdAt };
}
