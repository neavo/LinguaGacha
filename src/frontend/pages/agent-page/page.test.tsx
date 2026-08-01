import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentAssistantMessagePart } from "@shared/agent";
import type { useAgentPageState as UseAgentPageStateFunction } from "./use-agent-page-state";

type AgentPageState = ReturnType<typeof UseAgentPageStateFunction>;

const page_state = vi.hoisted(() => ({ current: {} as AgentPageState }));

vi.mock("./use-agent-page-state", () => ({ useAgentPageState: () => page_state.current }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ runtime_snapshot: { revision: 0, owner: null } }),
  useRuntimeSnapshot: () => ({ revision: 0, owner: null }),
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

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
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

  it("程序平滑滚动期间不会把中间帧误判为用户接管", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll_to = vi.fn();
    conversation.scrollTo = scroll_to;
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });

    await render_page({
      entries: [...page_state.current.entries, assistant_entry("assistant-2", "增量", false, 2)],
    });
    expect(scroll_to).toHaveBeenLastCalledWith({ top: 1000 });
    await act(async () => conversation.dispatchEvent(new Event("scroll", { bubbles: true })));
    scroll_to.mockClear();
    await render_page({
      entries: [...page_state.current.entries, assistant_entry("assistant-3", "继续", false, 3)],
    });
    expect(scroll_to).toHaveBeenLastCalledWith({ top: 1000 });

    await act(async () => conversation.dispatchEvent(new Event("scrollend", { bubbles: true })));
    scroll_to.mockClear();
    await render_page({
      entries: [...page_state.current.entries, assistant_entry("assistant-4", "停止", false, 4)],
    });
    expect(scroll_to).not.toHaveBeenCalled();
  });

  it("滚轮、指针和滚动键允许用户接管，回到底部后恢复跟随", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll_to = vi.fn();
    conversation.scrollTo = scroll_to;
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    const stop_events = [
      new WheelEvent("wheel", { bubbles: true }),
      new Event("pointerdown", { bubbles: true }),
      new KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }),
    ];

    for (const [index, event] of stop_events.entries()) {
      await act(async () => conversation.dispatchEvent(event));
      scroll_to.mockClear();
      await render_page({
        entries: [
          ...page_state.current.entries,
          assistant_entry(`assistant-stop-${index.toString()}`, "停止", false, index + 2),
        ],
      });
      expect(scroll_to).not.toHaveBeenCalled();

      conversation.scrollTop = 600;
      await act(async () => conversation.dispatchEvent(new Event("scroll", { bubbles: true })));
      scroll_to.mockClear();
      await render_page({
        entries: [
          ...page_state.current.entries,
          assistant_entry(`assistant-resume-${index.toString()}`, "恢复", false, index + 20),
        ],
      });
      expect(scroll_to).toHaveBeenLastCalledWith({ top: 1000 });
      conversation.scrollTop = 100;
    }
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
