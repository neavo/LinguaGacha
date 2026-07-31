import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentAssistantMessagePart, AgentEntry, AgentToolEntry } from "@shared/agent";
import type { useAgentPageState as UseAgentPageStateFunction } from "./use-agent-page-state";

type AgentPageState = ReturnType<typeof UseAgentPageStateFunction>;

const page_state = vi.hoisted(() => ({ current: {} as AgentPageState }));

vi.mock("./use-agent-page-state", () => ({ useAgentPageState: () => page_state.current }));
vi.mock("@frontend/features/model-selection/use-model-selection", async (import_original) => {
  const actual =
    await import_original<
      typeof import("@frontend/features/model-selection/use-model-selection")
    >();
  return {
    ...actual,
    useModelSelection: () => ({
      snapshot: {
        model_selection: { translation: "preset", analysis: "preset", agent: "agent" },
        models: [{ id: "agent", type: "CUSTOM_OPENAI", name: "Agent Model" }],
      },
      loading: false,
      updating: false,
      select_model: vi.fn(async () => undefined),
    }),
  };
});
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "agent_page.action.new_task") return "新任务";
      if (key === "agent_page.confirm.new_task") return "是否确认开始新的对话任务 …?";
      if (key === "agent_page.status.running") return "正在处理";
      if (key === "agent_page.status.success") return "已完成";
      if (key === "agent_page.status.error") return "失败";
      return params === undefined ? key : `${key}:${Object.values(params).join(",")}`;
    },
  }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { AgentPage } from "./page";

describe("AgentPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    vi.useRealTimers();
    container?.remove();
    root = null;
    container = null;
  });

  async function render_page(overrides: Partial<AgentPageState> = {}): Promise<HTMLDivElement> {
    page_state.current = build_state(overrides);
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <AgentPage is_sidebar_collapsed={false} />
        </TooltipProvider>,
      ),
    );
    return container;
  }

  it("空会话只显示一段搭档提示", async () => {
    const view = await render_page({ entries: [] });
    const empty = view.querySelector(".agent-page__empty");

    expect(empty?.querySelector("h2")).toBeNull();
    expect(empty?.querySelectorAll("p")).toHaveLength(1);
    expect(view.querySelector(".agent-composer__model-trigger")?.textContent).toContain(
      "Agent Model",
    );
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__reset")?.disabled).toBe(true);
  });

  it("把当前上下文用量装配到底栏", async () => {
    const view = await render_page({
      contextUsage: { tokens: 31_488, contextWindow: 256_000 },
    });

    expect(view.querySelector(".agent-composer__context-usage")?.textContent).toBe("12.3%");
  });

  it("用户离开消息底部后不被流式输出抢回滚动位置", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    const message_end = conversation?.lastElementChild as HTMLElement | null;
    if (conversation === null || message_end === null) throw new Error("缺少消息滚动容器");
    const scroll_into_view = vi.fn();
    message_end.scrollIntoView = scroll_into_view;
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    await act(async () => conversation.dispatchEvent(new Event("scroll", { bubbles: true })));

    await render_page({
      entries: [...page_state.current.entries, assistant_entry("assistant-2", "增量", false, 2)],
    });
    expect(scroll_into_view).not.toHaveBeenCalled();
  });

  it("渲染模型流式 Markdown 与统一状态灯", async () => {
    const view = await render_page({ state: "running" });

    expect(view.querySelector("strong")?.textContent).toBe("变更方案");
    const active_light = view.querySelector<HTMLElement>(".agent-status-light--active");
    expect(active_light?.classList.contains("agent-status-light--running")).toBe(true);
    expect(active_light?.getAttribute("aria-label")).toBe("正在处理");
    expect(view.querySelector(".agent-message__cursor")).toBeNull();
  });

  it("任务运行期间始终显示底部活动灯", async () => {
    const scenarios: AgentEntry[][] = [
      [user_entry("user-1", [{ kind: "text", text: "开始" }], 0, null)],
      [tool_entry("tool-success", "query_project_items", "success", "{}", 1)],
      [tool_entry("tool-error", "query_project_items", "error", "失败", 1)],
      [assistant_parts_entry("assistant-empty", [], false, 1)],
    ];

    for (const entries of scenarios) {
      const view = await render_page({ state: "running", entries });
      const active_lights = view.querySelectorAll(".agent-status-light--active");
      expect(active_lights).toHaveLength(1);
      expect(active_lights[0]?.parentElement?.classList.contains("agent-message__activity")).toBe(
        true,
      );
    }
  });

  it("运行工具在自身位置和文本区底部同时显示活动灯", async () => {
    const view = await render_page({
      state: "running",
      entries: [tool_entry("tool-1", "query_project_items", "running", null, 1)],
    });
    const active_lights = view.querySelectorAll(".agent-status-light--active");

    expect(active_lights).toHaveLength(2);
    expect(active_lights[0]?.closest("summary")).not.toBeNull();
    expect(
      view.querySelector(".agent-message__activity .agent-status-light--active"),
    ).not.toBeNull();
  });

  it("运行中逐秒更新长耗时，结束后冻结且不动态播报", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(45_295_000);
    const view = await render_page({
      state: "running",
      entries: [user_entry("user-1", [{ kind: "text", text: "开始" }], 0, null)],
    });
    const timer = view.querySelector<HTMLElement>('[role="timer"]');
    if (timer === null) throw new Error("缺少轮次计时器");

    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 55s");
    expect(timer.getAttribute("aria-live")).toBe("off");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(timer.textContent).toBe("agent_page.round.running:12h 34m 56s");

    await render_page({
      state: "complete",
      entries: [user_entry("user-1", [{ kind: "text", text: "开始" }], 0, 45_296_000)],
    });
    expect(timer.textContent).toBe("agent_page.round.ended:12h 34m 56s");
    await act(async () => vi.advanceTimersByTime(3_600_000));
    expect(timer.textContent).toBe("agent_page.round.ended:12h 34m 56s");
  });

  it("按秒、分钟分档格式化已结束轮次", async () => {
    const view = await render_page({
      state: "complete",
      entries: [
        user_entry("user-1", [{ kind: "text", text: "短任务" }], 0, 8_000),
        user_entry("user-2", [{ kind: "text", text: "长任务" }], 10_000, 738_000),
      ],
    });

    expect(
      [...view.querySelectorAll<HTMLElement>('[role="timer"]')].map((timer) => timer.textContent),
    ).toEqual(["agent_page.round.ended:8s", "agent_page.round.ended:12m 08s"]);
  });

  it("默认折叠流式思考，展开状态在正文到达后保持", async () => {
    const view = await render_page({
      state: "running",
      entries: [
        assistant_parts_entry(
          "assistant-1",
          [{ kind: "thinking", text: "检查术语\n逐项核对" }],
          false,
          1,
        ),
      ],
    });
    const thinking = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    if (thinking === null) throw new Error("缺少思考块");

    expect(thinking.open).toBe(false);
    expect(thinking.querySelector("summary")?.textContent).toBe("agent_page.thinking");
    expect(thinking.querySelector("pre")?.textContent).toBe("检查术语\n逐项核对");
    expect(thinking.querySelector("pre")?.tabIndex).toBe(0);
    expect(thinking.querySelector(".agent-status-light--active")).not.toBeNull();
    await act(async () => thinking.querySelector("summary")?.click());

    await render_page({
      state: "running",
      entries: [
        assistant_parts_entry(
          "assistant-1",
          [
            { kind: "thinking", text: "检查术语\n逐项核对完成" },
            { kind: "text", text: "**结论**" },
          ],
          false,
          1,
        ),
      ],
    });
    const updated = view.querySelector<HTMLDetailsElement>(".agent-detail-entry--thinking");
    expect(updated?.open).toBe(true);
    expect(updated?.querySelector("pre")?.textContent).toBe("检查术语\n逐项核对完成");
    expect(updated?.querySelector(".agent-status-light--success")).not.toBeNull();
    expect(view.querySelector("strong")?.textContent).toBe("结论");
    expect(view.querySelectorAll(".agent-status-light--active")).toHaveLength(1);
    expect(
      view.querySelector(".agent-message__activity .agent-status-light--active"),
    ).not.toBeNull();
  });

  it("空 assistant parts 不产生思考或正文块", async () => {
    const view = await render_page({
      entries: [assistant_parts_entry("assistant-1", [], true, 1)],
    });

    expect(view.querySelector(".agent-detail-entry--thinking")).toBeNull();
    expect(view.querySelector(".agent-message--assistant")).toBeNull();
  });

  it("按后端顺序交错渲染独立工具记录，并默认折叠完整输出", async () => {
    const view = await render_page({
      state: "complete",
      entries: [
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
        tool_entry("tool-2", "read_skill", "success", "# 审校标准\n\n完整正文", 1800),
        assistant_entry("assistant-2", "查询完成", true, 2000),
      ],
    });

    const visible_text = view.textContent ?? "";
    expect(visible_text.indexOf("请用")).toBeLessThan(visible_text.indexOf("准备查询"));
    expect(visible_text.indexOf("准备查询")).toBeLessThan(
      visible_text.indexOf("query_project_items"),
    );
    expect(visible_text.indexOf("query_project_items")).toBeLessThan(
      visible_text.indexOf("read_skill"),
    );
    expect(visible_text.indexOf("read_skill")).toBeLessThan(visible_text.indexOf("查询完成"));
    const tools = view.querySelectorAll<HTMLDetailsElement>(".agent-detail-entry--tool");
    expect(tools).toHaveLength(2);
    expect([...tools].every((tool) => !tool.open)).toBe(true);
    expect(tools[0]?.querySelector("summary")?.textContent).toBe("query_project_items");
    expect(tools[1]?.querySelector("summary")?.textContent).toBe("read_skill");
    const success_light = tools[0]?.querySelector(".agent-status-light--success");
    expect(success_light).toBe(tools[0]?.querySelector("summary")?.lastElementChild);
    expect(success_light?.getAttribute("aria-label")).toBe("已完成");
    expect(tools[0]?.querySelector("summary")?.textContent).not.toContain("Alice");
    await act(async () => tools[0]?.querySelector("summary")?.click());
    expect(tools[0]?.open).toBe(true);
    expect(tools[1]?.open).toBe(false);
    expect(tools[0]?.querySelector("pre")?.textContent).toBe(
      '{\n  "results": [\n    {\n      "pattern": "Alice",\n      "contexts": []\n    }\n  ]\n}',
    );
    expect(tools[0]?.querySelector("pre")?.tabIndex).toBe(0);
    expect(tools[1]?.querySelector("pre")?.textContent).toBe("# 审校标准\n\n完整正文");
    expect(view.querySelector(".agent-tool-group")).toBeNull();
    expect(view.querySelector(".agent-message__user-text")?.textContent).toBe(
      "请用 @glossary-audit\n查询",
    );
    expect(view.querySelector(".agent-message__user-text .agent-skill-token")?.textContent).toBe(
      "@glossary-audit",
    );
    expect(view.querySelector(".agent-round-header")?.textContent).toContain("2s");
    expect(view.querySelector(".agent-status-light--active")).toBeNull();
  });

  it("用右侧状态灯区分运行中和失败，并提供可访问名称", async () => {
    const view = await render_page({
      entries: [
        tool_entry("tool-1", "custom_reader", "running", null, 1),
        tool_entry("tool-2", "missing_tool", "error", "工具不存在", 2),
      ],
    });
    const tools = view.querySelectorAll<HTMLDetailsElement>(".agent-detail-entry--tool");
    expect(tools[0]?.querySelector("summary")?.textContent).toBe("custom_reader");
    const running_light = tools[0]?.querySelector(".agent-status-light--running");
    expect(running_light).toBe(tools[0]?.querySelector("summary")?.lastElementChild);
    expect(running_light?.getAttribute("aria-label")).toBe("正在处理");
    expect(tools[0]?.querySelector("pre")).toBeNull();
    expect(tools[1]?.querySelector("summary")?.textContent).toBe("missing_tool");
    const error_light = tools[1]?.querySelector(".agent-status-light--error");
    expect(error_light).toBe(tools[1]?.querySelector("summary")?.lastElementChild);
    expect(error_light?.getAttribute("aria-label")).toBe("失败");
    expect(tools[1]?.querySelector("pre")?.textContent).toBe("工具不存在");
  });

  it("按运行态切换提交按钮并允许停止", async () => {
    const stop = vi.fn();
    const view = await render_page({ state: "running", stop });
    const stop_button = get_button_by_label(view, "agent_page.action.stop");
    await act(async () => stop_button.click());
    expect(stop).toHaveBeenCalledOnce();
  });

  it("新任务先确认，取消不调用，确认期间锁定并在成功后关闭", async () => {
    let resolve_reset!: (accepted: boolean) => void;
    const reset = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolve_reset = resolve;
        }),
    );
    const view = await render_page({ reset });
    const reset_button = view.querySelector<HTMLButtonElement>(".agent-composer__reset");
    if (reset_button === null) throw new Error("缺少新任务按钮");

    await act(async () => reset_button.click());
    expect(document.body.querySelector('[data-slot="alert-dialog-description"]')?.textContent).toBe(
      "是否确认开始新的对话任务 …?",
    );
    const cancel = get_portal_button("app.action.cancel");
    await act(async () => cancel.click());
    expect(reset).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await act(async () => reset_button.click());
    const confirm = get_portal_button("app.action.confirm");
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(reset).toHaveBeenCalledOnce();
    await render_page({ reset, resetting: true });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
    expect(get_portal_button("app.action.cancel").disabled).toBe(true);

    await act(async () => resolve_reset(true));
    await act(async () =>
      vi.waitFor(() =>
        expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull(),
      ),
    );
  });

  it("重置失败后保留确认框供取消或重试", async () => {
    const reset = vi.fn(async () => false);
    const view = await render_page({ reset });
    const reset_button = view.querySelector<HTMLButtonElement>(".agent-composer__reset");
    if (reset_button === null) throw new Error("缺少新任务按钮");

    await act(async () => reset_button.click());
    await act(async () => get_portal_button("app.action.confirm").click());

    expect(reset).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
  });
});

function build_state(overrides: Partial<AgentPageState> = {}): AgentPageState {
  const skills = [
    { name: "glossary-audit", description: "审校术语" },
    { name: "corpus-search", description: "检索语料" },
  ];
  return {
    state: "idle",
    entries: [assistant_entry("assistant-1", "**变更方案**", false, 1)],
    skills,
    contextUsage: overrides.contextUsage ?? null,
    loading: false,
    error: false,
    resetting: false,
    send: vi.fn(async () => true),
    stop: vi.fn(),
    reset: vi.fn(async () => true),
    ...overrides,
  };
}

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
  return {
    kind: "tool_call" as const,
    id,
    toolName,
    status,
    output,
    createdAt,
  };
}

function get_button_by_label(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`缺少按钮：${label}`);
  return button;
}

function get_portal_button(label: string): HTMLButtonElement {
  const dialog = document.body.querySelector('[data-slot="alert-dialog-content"]');
  const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`缺少弹窗按钮：${label}`);
  return button;
}
