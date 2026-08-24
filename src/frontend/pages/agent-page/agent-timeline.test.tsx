import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentAssistantMessageParts,
  AgentContextCompactionEntry,
  AgentEntry,
  AgentEntryStatus,
  AgentToolEntry,
} from "@shared/agent";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

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
type ScrollMetrics = {
  top: number;
  height: number;
  viewport: number;
};

/** 按浏览器夹取规则从测试几何计算底端。 */
function scroll_end(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.height - metrics.viewport);
}

/** 只模拟可测几何与显式写入。 */
function install_scroll_metrics(target: HTMLElement, metrics: ScrollMetrics): void {
  Object.defineProperties(target, {
    scrollHeight: { configurable: true, get: () => metrics.height },
    clientHeight: { configurable: true, get: () => metrics.viewport },
    scrollTop: {
      configurable: true,
      get: () => metrics.top,
      set: (value: number) => {
        metrics.top = Math.max(0, Math.min(value, scroll_end(metrics)));
      },
    },
  });
}

describe("AgentTimeline", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const on_edit = vi.fn();
  const on_continue = vi.fn();
  const on_add_annotation = vi.fn();
  const write_clipboard = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: write_clipboard },
    });
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    vi.useRealTimers();
    container?.remove();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    root = null;
    container = null;
    on_edit.mockReset();
    on_continue.mockReset();
    on_add_annotation.mockReset();
    write_clipboard.mockReset();
    vi.unstubAllGlobals();
  });

  /** 复用同一 root，确保模态选择和思考详情状态跨增量保留。 */
  async function render_timeline(entries: readonly AgentEntry[]): Promise<HTMLDivElement> {
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
            on_continue={on_continue}
            on_edit={on_edit}
            on_add_annotation={on_add_annotation}
            revision_disabled={false}
            continue_disabled={false}
            annotation_disabled={false}
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

  it("附件画廊与消息文本是相邻的独立区域", async () => {
    const view = await render_timeline([
      user_entry("user-mixed", "请检查这些内容", "success", 0, 1_000, ["webp-a"]),
    ]);

    const message = view.querySelector(".agent-message--user");
    expect(message?.children[0]?.classList.contains("agent-attachment-strip")).toBe(true);
    expect(message?.children[1]?.classList.contains("agent-message__user-text")).toBe(true);
    expect(message?.querySelector(".agent-attachment-strip .agent-message__user-text")).toBeNull();
  });

  it("steer user 显示在当前轮次中但不建立轮次操作或尾标", async () => {
    const steer: AgentEntry = {
      kind: "user_message",
      id: "user-steer",
      delivery: "steer",
      text: "立即补充",
      attachments: [],
      status: "success",
      createdAt: 2_000,
      endedAt: 2_000,
    };
    const view = await render_timeline([
      user_entry("user-round", "开始", "success", 0, 4_000),
      assistant_entry("assistant-first", "处理中", "success", 1_000),
      steer,
      assistant_entry("assistant-final", "完成", "success", 3_000),
    ]);

    const steer_message = [...view.querySelectorAll<HTMLElement>(".agent-message--user")].find(
      (message) => message.textContent === "立即补充",
    );
    const steer_frame = steer_message?.closest(".agent-message-frame");
    expect(steer_message).toBeDefined();
    expect(steer_frame?.querySelector(".agent-message-actions")).toBeNull();
    expect(view.querySelectorAll(".agent-round-footer")).toHaveLength(1);
  });

  it("只让成功轮次的最终助手正文进入可批注边界", async () => {
    const view = await render_timeline([
      user_entry("user-1", "开始", "success", 0, 4_000),
      assistant_entry("assistant-intermediate", "准备工作", "success", 1_000),
      tool_entry("tool-1", "workspace_load", "success", "{}", 2_000),
      assistant_entry("assistant-final", "最终结果", "success", 3_000),
    ]);
    const surfaces = view.querySelectorAll<HTMLElement>(".agent-markdown");
    expect(surfaces[0]?.hasAttribute("data-agent-annotation-content")).toBe(false);
    expect(surfaces[1]?.getAttribute("data-agent-annotation-content")).toBe("true");
  });

  it("最新失败轮次可分别修改输入与输出，且只保留一处继续入口", async () => {
    const view = await render_timeline([
      user_entry("user-old-error", "旧任务", "error", 0, 2_000),
      assistant_entry("assistant-old-error", "旧部分结果", "error", 1_000),
      user_entry("user-error", "最新任务", "error", 3_000, 5_000),
      assistant_entry("assistant-error", "最新部分结果", "error", 4_000),
    ]);
    const assistants = view.querySelectorAll(".agent-message--assistant");
    const continue_entries = view.querySelectorAll<HTMLButtonElement>(".agent-continue-entry");
    const footers = view.querySelectorAll(".agent-round-footer");
    const error = continue_entries[0];
    const latest_assistant = assistants[1];
    const latest_footer = footers[1];
    if (error === undefined || latest_assistant === undefined || latest_footer === undefined) {
      throw new Error("缺少失败轮次结构");
    }

    expect(continue_entries).toHaveLength(1);
    expect(
      latest_assistant.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      error.compareDocumentPosition(latest_footer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(error.textContent).toContain("app.error.model.provider_failed.message");
    expect(error.textContent).toContain("agent_page.action.continue");
    await act(async () => error.click());
    expect(on_continue).toHaveBeenCalledOnce();
    const edits = [
      ...view.querySelectorAll<HTMLButtonElement>(".agent-message-actions button"),
    ].filter((button) => button.textContent === "agent_page.action.edit");
    expect(edits).toHaveLength(2);
    expect(latest_footer.querySelector("button")).toBeNull();
    await act(async () => edits[0]?.click());
    expect(on_edit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "user_message", id: "user-error" }),
    );
    await act(async () => edits[1]?.click());
    expect(on_edit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "assistant_message", id: "assistant-error" }),
    );
  });

  it("成功轮次只允许修改最终 assistant，状态行不提供回合重试", async () => {
    const view = await render_timeline([
      user_entry("user-1", "开始", "success", 0, 4_000),
      assistant_entry("assistant-intermediate", "准备调用工具", "success", 1_000),
      tool_entry("tool-1", "workspace_load", "success", "{}", 2_000),
      assistant_entry("assistant-final", "最终结果", "success", 3_000),
    ]);
    const user_actions = view.querySelectorAll<HTMLButtonElement>(
      ".agent-message-frame--user .agent-message-actions button",
    );
    const output_actions = view.querySelectorAll<HTMLButtonElement>(
      ".agent-message-frame--assistant .agent-message-actions button",
    );

    expect([...user_actions].map((button) => button.textContent)).toEqual([
      "agent_page.action.copy",
      "agent_page.action.edit",
    ]);
    expect([...output_actions].map((button) => button.textContent)).toEqual([
      "agent_page.action.copy",
      "agent_page.action.edit",
    ]);
    await act(async () =>
      [...output_actions]
        .find((button) => button.textContent === "agent_page.action.edit")
        ?.click(),
    );
    expect(on_edit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "assistant-final", kind: "assistant_message" }),
    );
    expect(view.querySelector(".agent-continue-entry")).toBeNull();
    expect(view.querySelector(".agent-round-footer button")).toBeNull();
  });

  it("流式输出不显示复制或修改操作", async () => {
    const view = await render_timeline([
      user_entry("user-running", "处理中", "running", 0, null),
      assistant_entry("assistant-running", "部分输出", "running", 1_000),
    ]);

    expect(view.querySelectorAll(".agent-message-actions")).toHaveLength(0);
  });

  it("成功轮次没有输出时仍只提供输入复制与修改", async () => {
    const view = await render_timeline([user_entry("user-only", "开始", "success", 0, 1_000)]);
    const actions = view.querySelectorAll<HTMLButtonElement>(
      ".agent-message-frame--user .agent-message-actions button",
    );

    expect([...actions].map((button) => button.textContent)).toEqual([
      "agent_page.action.copy",
      "agent_page.action.edit",
    ]);
    expect(view.querySelector(".agent-round-footer button")).toBeNull();
  });

  it("输入与输出正文都可复制并显示完成反馈", async () => {
    const view = await render_timeline([
      user_entry("user-copy", "输入正文", "success", 0, 2_000),
      assistant_entry("assistant-copy", "输出正文", "success", 1_000),
    ]);
    const copy_buttons = [
      ...view.querySelectorAll<HTMLButtonElement>(".agent-message-actions button"),
    ].filter((button) => button.textContent === "agent_page.action.copy");
    expect(copy_buttons).toHaveLength(2);

    await act(async () => copy_buttons[0]?.click());
    await vi.waitFor(() => expect(copy_buttons[0]?.textContent).toBe("agent_page.action.copied"));
    expect(write_clipboard).toHaveBeenCalledWith("输入正文");

    await act(async () => copy_buttons[1]?.click());
    await vi.waitFor(() => expect(copy_buttons[1]?.textContent).toBe("agent_page.action.copied"));
    expect(write_clipboard).toHaveBeenLastCalledWith("输出正文");
  });

  it("压缩三态原位覆盖，失败时只开放统一恢复", async () => {
    const round = [
      user_entry("user-error", "继续检查", "error", 0, 2_000),
      assistant_entry("assistant-error", "部分结果", "error", 1_000),
    ];
    const view = await render_timeline([
      ...round,
      compaction_entry("compaction-1", "running", 1_500),
    ]);
    expect(view.querySelector(".agent-context-compaction")?.textContent).toContain(
      "agent_page.compaction.running",
    );
    expect(view.querySelector(".agent-round-footer[data-running]")).toBeNull();

    await render_timeline([...round, compaction_entry("compaction-1", "error", 1_500)]);
    const continue_button = view.querySelector<HTMLButtonElement>(".agent-continue-entry");
    expect(continue_button?.textContent).toContain("agent_page.compaction.error");
    expect(continue_button?.textContent).toContain("agent_page.action.continue");
    await act(async () => continue_button?.click());
    expect(on_continue).toHaveBeenCalledOnce();

    await render_timeline([...round, compaction_entry("compaction-1", "success", 1_500)]);
    expect(view.querySelector(".agent-context-compaction")?.textContent).toContain(
      "agent_page.compaction.success",
    );
    expect(view.querySelector(".agent-continue-entry")?.textContent).toContain(
      "app.error.model.provider_failed.message",
    );
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
  });

  it("并行工具用状态灯与可访问名称保留独立状态语义", async () => {
    const view = await render_timeline(
      round_entries([
        tool_entry("tool-running", "workspace_script", "running", null, 1),
        tool_entry("tool-success", "workspace_load", "success", "{}", 2),
        tool_entry("tool-error", "read_skill", "error", "工具不存在", 3),
        tool_entry("tool-stopped", "workspace_apply", "stopped", null, 4),
      ]),
    );
    for (const [status, label] of [
      ["running", "agent_page.status.running"],
      ["success", "agent_page.status.success"],
      ["error", "agent_page.status.error"],
      ["stopped", "agent_page.status.stopped"],
    ] as const) {
      const mark = view.querySelector<HTMLElement>(
        `.agent-tool-entry .agent-status-mark--${status}[role="img"]`,
      );
      expect(mark?.getAttribute("aria-label")).toBe(label);
    }
  });

  it("流式思考持续跟随，用户接管后保持位置并在自然回底后恢复", async () => {
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
    const viewport = thinking?.querySelector<HTMLDivElement>(".agent-thinking-entry__viewport");
    if (thinking === null || viewport === null || viewport === undefined) {
      throw new Error("缺少思考块");
    }
    expect(thinking.open).toBe(true);

    const scroll = { top: 240, height: 480, viewport: 240 };
    install_scroll_metrics(viewport, scroll);

    scroll.height = 560;
    await render_thinking("检查术语\n逐项核对完成\n继续检查语境");
    expect(scroll.top).toBe(scroll_end(scroll));

    scroll.top = 80;
    await act(async () => {
      viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
      viewport.dispatchEvent(new Event("scroll"));
    });
    scroll.height = 640;
    await render_thinking("检查术语\n逐项核对完成\n继续检查语境\n再检查一项");
    expect(scroll.top).toBe(80);

    scroll.top = 400;
    await act(async () => viewport.dispatchEvent(new Event("scroll")));
    scroll.height = 720;
    await render_thinking("检查术语\n逐项核对完成\n继续检查语境\n再检查一项\n确认结果");
    expect(scroll.top).toBe(scroll_end(scroll));
  });

  it("普通历史详情首次打开与重新渲染都保留阅读位置", async () => {
    const history_entries = round_entries(
      [
        assistant_parts_entry(
          "assistant-history",
          [{ kind: "thinking", text: "历史思考" }],
          "success",
          1,
        ),
      ],
      "success",
    );
    const view = await render_timeline(history_entries);
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-thinking-entry");
    const viewport = thinking?.querySelector<HTMLElement>(".agent-thinking-entry__viewport");
    if (thinking === null || viewport === null || viewport === undefined) {
      throw new Error("缺少历史思考块");
    }
    const scroll = { top: 40, height: 480, viewport: 240 };
    install_scroll_metrics(viewport, scroll);

    await act(async () => thinking.querySelector("summary")?.click());
    expect(thinking.open).toBe(true);
    expect(scroll.top).toBe(40);

    await act(async () => thinking.querySelector("summary")?.click());
    await render_timeline(history_entries);
    expect(scroll.top).toBe(40);

    await act(async () => thinking.querySelector("summary")?.click());
    expect(scroll.top).toBe(40);
  });

  it("重新打开时跟随详情归底一次，历史详情保留位置", async () => {
    const render_thinking = (text: string) =>
      render_timeline(
        round_entries([
          assistant_parts_entry("assistant-reopen", [{ kind: "thinking", text }], "running", 1),
        ]),
      );
    const view = await render_thinking("检查术语");
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-thinking-entry");
    const viewport = thinking?.querySelector<HTMLElement>(".agent-thinking-entry__viewport");
    if (thinking === null || viewport === null || viewport === undefined) {
      throw new Error("缺少运行中思考块");
    }
    const scroll = { top: 0, height: 480, viewport: 240 };
    install_scroll_metrics(viewport, scroll);
    await render_thinking("检查术语\n继续检查");
    expect(scroll.top).toBe(scroll_end(scroll));

    await act(async () => thinking.querySelector("summary")?.click());
    scroll.height = 560;
    await render_thinking("检查术语\n继续检查\n继续核对");
    expect(scroll.top).toBe(240);
    await act(async () => thinking.querySelector("summary")?.click());
    expect(scroll.top).toBe(scroll_end(scroll));

    scroll.top = 80;
    await act(async () => viewport.dispatchEvent(new Event("scroll")));
    await act(async () => thinking.querySelector("summary")?.click());
    scroll.height = 640;
    await render_thinking("检查术语\n继续检查\n再检查");
    await act(async () => thinking.querySelector("summary")?.click());
    expect(scroll.top).toBe(80);
  });

  it("未手动操作的思考结束后自动关闭且不影响后续正文", async () => {
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
    expect(view.querySelector("strong")?.textContent).toBe("结论");
  });

  it("完成后处于历史位置不收缩，自然回底后重新计时", async () => {
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
    const viewport = thinking?.querySelector<HTMLElement>(".agent-thinking-entry__viewport");
    if (thinking === null || viewport === null || viewport === undefined) {
      throw new Error("缺少思考块");
    }
    const scroll = { top: 0, height: 480, viewport: 240 };
    install_scroll_metrics(viewport, scroll);

    scroll.top = 80;
    await act(async () => viewport.dispatchEvent(new Event("scroll")));

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
    await act(async () => vi.runOnlyPendingTimers());
    expect(thinking.open).toBe(true);

    scroll.top = 240;
    await act(async () => viewport.dispatchEvent(new Event("scroll")));
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
    await act(async () => history.querySelector("summary")?.click());
    await act(async () => vi.runOnlyPendingTimers());
    expect(history.open).toBe(true);
    expect(history.querySelector("pre")?.textContent).toBe("历史思考");
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
      tool_entry("progress-1", "task_progress", "success", '{"status":"active"}', 1700),
      tool_entry("tool-2", "read_skill", "error", "工具不存在", 1800),
      assistant_entry("assistant-2", "查询完成", "success", 2000),
    ]);
    const visible_text = view.textContent ?? "";
    expect(visible_text.indexOf("准备查询")).toBeLessThan(visible_text.indexOf("workspace_script"));
    expect(visible_text.indexOf("workspace_script")).toBeLessThan(
      visible_text.indexOf("read_skill"),
    );
    expect(visible_text).not.toContain("task_progress");
    const tools = view.querySelectorAll<HTMLButtonElement>(".agent-tool-entry");
    expect(tools[0]?.textContent).not.toContain("Alice");
    expect(tools[1]?.querySelector(".agent-status-mark--error")?.getAttribute("aria-label")).toBe(
      "agent_page.status.error",
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
    delivery: "round" as const,
    text,
    attachments: images.map((webpBase64) => ({ kind: "image" as const, webpBase64 })),
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
  parts: AgentAssistantMessageParts,
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
