import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentAssistantMessagePart, AgentEntryStatus } from "@shared/agent";
import type { useAgentPageState as UseAgentPageStateFunction } from "./use-agent-page-state";

type AgentPageState = ReturnType<typeof UseAgentPageStateFunction>;

const page_state = vi.hoisted(() => ({ current: {} as AgentPageState }));
/** 用真实 hook 返回形状驱动 runtime owner 迁移，不复制 store 内部实现。 */
const runtime_state = vi.hoisted(() => ({
  current: { revision: 0, owner: null as "task" | "agent" | null },
}));

vi.mock("./use-agent-page-state", () => ({ useAgentPageState: () => page_state.current }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ runtime_snapshot: runtime_state.current }),
  useRuntimeSnapshot: () => runtime_state.current,
}));
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
        models: [
          {
            id: "agent",
            type: "CUSTOM_OPENAI",
            name: "Agent Model",
            agent: { context_window: 288_000, max_output_tokens: 32_000 },
          },
        ],
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
      if (key === "agent_page.action.send") return "发送";
      if (key === "agent_page.confirm.new_task") return "是否确认开始新的对话任务 …?";
      if (key === "agent_page.empty.suggestions.capabilities") return "介绍一下你的能力";
      if (key === "agent_page.empty.suggestions.glossary_audit") return "请帮我审校术语表";
      return params === undefined ? key : `${key}:${Object.values(params).join(",")}`;
    },
  }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { AgentPage } from "./page";

describe("AgentPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    runtime_state.current = { revision: 0, owner: null };
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  /** 只替换页面拥有者的公开快照，并复用 root 验证真实状态迁移。 */
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

  it("空会话显示两个起始任务并写入结构化草稿", async () => {
    const send = vi.fn(async () => false);
    const view = await render_page({ entries: [], send });
    const empty = view.querySelector(".agent-page__empty");
    const suggestions = [...view.querySelectorAll<HTMLButtonElement>(".agent-page__suggestion")];
    const editor = view.querySelector<HTMLElement>(".cm-content");
    const submit = get_button_by_label(view, "发送");

    expect(suggestions.map((button) => button.textContent)).toEqual([
      "介绍一下你的能力",
      "请帮我审校术语表 @glossary-audit",
    ]);
    expect(view.querySelector(".agent-composer__model-trigger")?.textContent).toContain(
      "Agent Model",
    );
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__reset")?.disabled).toBe(true);

    await act(async () => suggestions[0]?.click());
    expect(send).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith([{ kind: "text", text: "介绍一下你的能力" }]);

    await act(async () => suggestions[1]?.click());
    expect(empty?.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith([
      { kind: "text", text: "请帮我审校术语表 " },
      { kind: "skill", name: "glossary-audit" },
    ]);

    await render_page();
    expect(view.querySelectorAll(".agent-page__suggestion")).toHaveLength(0);
  });

  it("术语 skill 未加载时不展示不可提交的快捷入口", async () => {
    const view = await render_page({ entries: [], skills: [] });
    expect(
      [...view.querySelectorAll<HTMLButtonElement>(".agent-page__suggestion")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["介绍一下你的能力"]);
  });

  it("把当前上下文用量装配到底栏", async () => {
    const view = await render_page({
      contextUsage: { tokens: 31_488, contextWindow: 288_000, maxTokens: 32_000 },
    });
    expect(view.querySelector(".agent-composer__context-usage")?.textContent).toBe("10.9%");
  });

  it("按时间线顺序把全部用户消息装配为输入历史", async () => {
    const view = await render_page({
      entries: [
        user_entry("user-1", "较旧消息", 1),
        assistant_entry("assistant-1", "回复", "success", 2),
        user_entry("user-2", "最新消息", 3),
      ],
    });
    const editor = view.querySelector<HTMLElement>(".cm-content");
    if (editor === null) throw new Error("缺少 CodeMirror 编辑器");

    for (const expected of ["最新消息", "较旧消息"]) {
      await act(async () =>
        editor.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
        ),
      );
      expect(editor.textContent).toBe(expected);
    }
  });

  it("恢复失败时显示单一重试入口并重新连接", async () => {
    const retry = vi.fn();
    const view = await render_page({ issue: "restore", retry });
    const alert = view.querySelector<HTMLElement>('[role="alert"]');
    const retry_button = [...view.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "agent_page.action.retry",
    );
    if (retry_button === undefined) throw new Error("缺少恢复重试按钮");

    expect(alert?.textContent).toContain("agent_page.error.restore");
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__model-trigger")?.disabled).toBe(
      true,
    );
    await act(async () => retry_button.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("公开回合先结束但 Agent lease 尚未释放时保持结算禁用态", async () => {
    runtime_state.current = { revision: 1, owner: "agent" };
    const view = await render_page({ state: "idle" });
    const model = view.querySelector<HTMLButtonElement>(".agent-composer__model-trigger");

    expect(model?.disabled).toBe(true);
    runtime_state.current = { revision: 2, owner: null };
    await render_page({ state: "idle" });
    expect(model?.disabled).toBe(false);
  });

  it("外层只按自身真实位置暂停，回到底端后恢复追随", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    let scroll_top = 600;
    const writes: number[] = [];
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: {
        configurable: true,
        get: () => scroll_top,
        set: (value: number) => {
          scroll_top = Math.min(value, 600);
          writes.push(value);
        },
      },
    });

    scroll_top = 100;
    await act(async () => conversation.dispatchEvent(new Event("scroll")));
    writes.length = 0;
    await render_page({
      entries: [
        ...page_state.current.entries,
        assistant_entry("assistant-2", "增量", "running", 2),
      ],
    });
    expect(writes).toEqual([]);
    expect(view.textContent).toContain("agent_page.action.return_latest");

    scroll_top = 600;
    await act(async () => conversation.dispatchEvent(new Event("scroll")));
    writes.length = 0;
    await render_page({
      entries: [
        ...page_state.current.entries,
        assistant_entry("assistant-3", "继续", "running", 3),
      ],
    });
    expect(writes).toContain(1000);
    expect(view.textContent).not.toContain("agent_page.action.return_latest");
  });

  it("思考块离底会暂停外层，回底后恢复且不覆盖外层独立暂停", async () => {
    const render_thinking = (text: string) =>
      render_page({
        state: "running",
        entries: [
          assistant_parts_entry("assistant-thinking", [{ kind: "thinking", text }], "running", 1),
        ],
      });
    const view = await render_thinking("第一步\n第二步");
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    const thinking = view.querySelector<HTMLPreElement>(".agent-detail-entry--thinking pre");
    if (conversation === null || thinking === null) throw new Error("缺少嵌套滚动容器");
    let outer_top = 600;
    let inner_top = 240;
    const outer_writes: number[] = [];
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: {
        configurable: true,
        get: () => outer_top,
        set: (value: number) => {
          outer_top = Math.min(value, 600);
          outer_writes.push(value);
        },
      },
    });
    Object.defineProperties(thinking, {
      scrollHeight: { configurable: true, value: 480 },
      clientHeight: { configurable: true, value: 240 },
      scrollTop: {
        configurable: true,
        get: () => inner_top,
        set: (value: number) => {
          inner_top = Math.min(value, 240);
        },
      },
    });

    inner_top = 80;
    await act(async () => thinking.dispatchEvent(new Event("scroll")));
    outer_writes.length = 0;
    await render_thinking("第一步\n第二步\n第三步");
    expect(inner_top).toBe(80);
    expect(outer_writes).toEqual([]);

    outer_top = 100;
    await act(async () => conversation.dispatchEvent(new Event("scroll")));
    inner_top = 240;
    await act(async () => thinking.dispatchEvent(new Event("scroll")));
    outer_writes.length = 0;
    await render_thinking("第一步\n第二步\n第三步\n第四步");
    expect(outer_writes).toEqual([]);

    const latest = [...view.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "agent_page.action.return_latest",
    );
    await act(async () => latest?.click());
    expect(outer_writes).toContain(1000);
  });

  it("按运行态切换提交按钮并允许停止", async () => {
    const stop = vi.fn();
    const view = await render_page({ state: "running", stop });
    await act(async () => get_button_by_label(view, "agent_page.action.stop").click());
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
    await act(async () => get_portal_button("app.action.cancel").click());
    expect(reset).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await act(async () => reset_button.click());
    const confirm = get_portal_button("app.action.confirm");
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(reset).toHaveBeenCalledOnce();
    await render_page({ reset, command: "reset" });
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
    {
      name: "glossary-audit",
      displayDescriptions: {
        "zh-CN": "审校术语",
        "en-US": "Review glossary",
        "de-DE": "Glossar prüfen",
      },
    },
    {
      name: "corpus-search",
      displayDescriptions: {
        "zh-CN": "检索语料",
        "en-US": "Search corpus",
        "de-DE": "Korpus durchsuchen",
      },
    },
  ];
  return {
    state: "idle",
    entries: [assistant_entry("assistant-1", "**变更方案**", "success", 1)],
    skills,
    contextUsage: overrides.contextUsage ?? null,
    loading: false,
    command: null,
    issue: null,
    send: vi.fn(async () => true),
    stop: vi.fn(),
    reset: vi.fn(async () => true),
    retry: vi.fn(),
    ...overrides,
  };
}

function assistant_entry(id: string, text: string, status: AgentEntryStatus, createdAt: number) {
  return assistant_parts_entry(id, [{ kind: "text", text }], status, createdAt);
}

function user_entry(id: string, text: string, createdAt: number) {
  return {
    kind: "user_message" as const,
    id,
    parts: [{ kind: "text" as const, text }],
    status: "success" as const,
    createdAt,
    endedAt: createdAt,
  };
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
