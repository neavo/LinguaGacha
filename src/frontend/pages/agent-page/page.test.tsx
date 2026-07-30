import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentToolEntry } from "@shared/agent";
import type { useAgentPageState as UseAgentPageStateFunction } from "./use-agent-page-state";

type AgentPageState = ReturnType<typeof UseAgentPageStateFunction>;

const page_state = vi.hoisted(() => ({ current: {} as AgentPageState }));
const desktop_api_mocks = vi.hoisted(() => ({ open_external_url: vi.fn() }));

vi.mock("./use-agent-page-state", () => ({ useAgentPageState: () => page_state.current }));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => desktop_api_mocks);
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
    desktop_api_mocks.open_external_url.mockReset();
  });

  async function render_page(overrides: Partial<AgentPageState> = {}): Promise<HTMLDivElement> {
    page_state.current = build_state(overrides);
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<AgentPage is_sidebar_collapsed={false} />));
    return container;
  }

  it("空会话只显示一段搭档提示", async () => {
    const view = await render_page({ entries: [] });
    const empty = view.querySelector(".agent-page__empty");

    expect(empty?.querySelector("h2")).toBeNull();
    expect(empty?.querySelectorAll("p")).toHaveLength(1);
  });

  it("把 Markdown 链接交给宿主外链入口", async () => {
    const view = await render_page({
      entries: [assistant_entry("assistant-1", "[证据](https://example.com)", true, 1)],
    });
    const link = view.querySelector<HTMLAnchorElement>('a[href="https://example.com"]');
    if (link === null) throw new Error("缺少 Markdown 链接");

    await act(async () => link.click());
    expect(desktop_api_mocks.open_external_url).toHaveBeenCalledWith("https://example.com");
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

  it("渲染模型流式 Markdown 与光标", async () => {
    const view = await render_page({ state: "running" });

    expect(view.querySelector("strong")?.textContent).toBe("变更方案");
    expect(view.querySelector(".agent-message__cursor")).not.toBeNull();
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
        ),
        assistant_entry("assistant-1", "准备查询", true, 1000),
        tool_entry(
          "tool-1",
          "search_corpus",
          "success",
          '{"results":[{"pattern":"Alice","contexts":[]}]}',
          1500,
        ),
        tool_entry("tool-2", "read_skill_reference", "success", "# 审校标准\n\n完整正文", 1800),
        assistant_entry("assistant-2", "查询完成", true, 2000),
      ],
    });

    const visible_text = view.textContent ?? "";
    expect(visible_text.indexOf("请用")).toBeLessThan(visible_text.indexOf("准备查询"));
    expect(visible_text.indexOf("准备查询")).toBeLessThan(visible_text.indexOf("search_corpus"));
    expect(visible_text.indexOf("search_corpus")).toBeLessThan(
      visible_text.indexOf("read_skill_reference"),
    );
    expect(visible_text.indexOf("read_skill_reference")).toBeLessThan(
      visible_text.indexOf("查询完成"),
    );
    const tools = view.querySelectorAll<HTMLDetailsElement>(".agent-tool-entry");
    expect(tools).toHaveLength(2);
    expect([...tools].every((tool) => !tool.open)).toBe(true);
    expect(tools[0]?.querySelector("summary")?.textContent).toBe("search_corpus");
    expect(tools[1]?.querySelector("summary")?.textContent).toBe("read_skill_reference");
    const success_light = tools[0]?.querySelector(".agent-tool-entry__status--success");
    expect(success_light).toBe(tools[0]?.querySelector("summary")?.lastElementChild);
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
  });

  it("用右侧状态灯区分运行中和失败，不显示状态文字", async () => {
    const view = await render_page({
      entries: [
        tool_entry("tool-1", "custom_reader", "running", null, 1),
        tool_entry("tool-2", "missing_tool", "error", "工具不存在", 2),
      ],
    });
    const tools = view.querySelectorAll<HTMLDetailsElement>(".agent-tool-entry");
    expect(tools[0]?.querySelector("summary")?.textContent).toBe("custom_reader");
    const running_light = tools[0]?.querySelector(".agent-tool-entry__status--running");
    expect(running_light).toBe(tools[0]?.querySelector("summary")?.lastElementChild);
    expect(tools[0]?.querySelector("pre")).toBeNull();
    expect(tools[1]?.querySelector("summary")?.textContent).toBe("missing_tool");
    const error_light = tools[1]?.querySelector(".agent-tool-entry__status--error");
    expect(error_light).toBe(tools[1]?.querySelector("summary")?.lastElementChild);
    expect(tools[1]?.querySelector("pre")?.textContent).toBe("工具不存在");
  });

  it("按运行态切换提交按钮并允许停止", async () => {
    const stop = vi.fn();
    const view = await render_page({ state: "running", stop });
    const stop_button = get_button_by_label(view, "agent_page.action.stop");
    await act(async () => stop_button.click());
    expect(stop).toHaveBeenCalledOnce();
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
    loading: false,
    error: false,
    send: vi.fn(async () => true),
    stop: vi.fn(),
    ...overrides,
  };
}

function user_entry(
  id: string,
  parts: Array<{ kind: "text"; text: string } | { kind: "skill"; name: string }>,
  createdAt: number,
) {
  return { kind: "user_message" as const, id, parts, createdAt };
}

function assistant_entry(id: string, text: string, complete: boolean, createdAt: number) {
  return { kind: "assistant_message" as const, id, text, complete, createdAt };
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
