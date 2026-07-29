import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { useAgentPageState as UseAgentPageStateFunction } from "./use-agent-page-state";

type AgentPageState = ReturnType<typeof UseAgentPageStateFunction>;

const page_state = vi.hoisted(() => ({
  current: {} as AgentPageState,
}));
const desktop_api_mocks = vi.hoisted(() => ({ open_external_url: vi.fn() }));

vi.mock("./use-agent-page-state", () => ({
  useAgentPageState: () => page_state.current,
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => desktop_api_mocks);

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

  it("用键盘选择和取消能力", async () => {
    const select_skill = vi.fn();
    const update_input = vi.fn();
    const view = await render_page({
      select_skill,
      update_input,
    });

    const input = view.querySelector("textarea");
    if (input === null) throw new Error("缺少 Agent 输入框");
    expect(input.getAttribute("aria-activedescendant")).toBe("agent-skill-glossary-audit");
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(select_skill).toHaveBeenCalledWith("glossary-audit");
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(update_input).toHaveBeenCalledWith("");
  });

  it("把 Markdown 链接交给宿主外链入口", async () => {
    const view = await render_page({
      skill_menu_open: false,
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "[证据](https://example.com)",
          createdAt: 1,
          complete: true,
        },
      ],
    });

    const link = view.querySelector<HTMLAnchorElement>('a[href="https://example.com"]');
    if (link === null) throw new Error("缺少 Markdown 链接");
    await act(async () => link.click());
    expect(desktop_api_mocks.open_external_url).toHaveBeenCalledWith("https://example.com");
  });

  it("用户离开消息底部后不被流式输出抢回滚动位置", async () => {
    const view = await render_page({ skill_menu_open: false });

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
      skill_menu_open: false,
      messages: [
        ...page_state.current.messages,
        { id: "assistant-2", role: "assistant", text: "增量", createdAt: 2, complete: false },
      ],
    });
    expect(scroll_into_view).not.toHaveBeenCalled();
  });

  it("渲染模型流式 Markdown 增量", async () => {
    const view = await render_page({ state: "running", skill_menu_open: false });

    expect(view.querySelector("strong")?.textContent).toBe("变更方案");
    expect(view.querySelector(".agent-message__cursor")).not.toBeNull();
  });

  it("从能力列表选择 skill", async () => {
    const select_skill = vi.fn();
    const view = await render_page({ select_skill });

    const skill_option = get_button(view, "glossary-audit");
    await act(async () => skill_option.click());
    expect(select_skill).toHaveBeenCalledWith("glossary-audit");
  });

  it("按选中能力和会话状态切换操作区", async () => {
    const view = await render_page({
      skill_menu_open: false,
      selected_skill: "custom-audit",
      skills: [{ name: "custom-audit", description: "自定义能力说明" }],
    });
    expect(view.querySelector(".agent-composer__skill span")?.textContent).toBe("custom-audit");
    expect(get_button(view, "agent_page.action.stop").disabled).toBe(true);

    await render_page({ state: "running", skill_menu_open: false });
    expect(get_button(view, "agent_page.action.stop").disabled).toBe(false);
    expect(get_button(view, "agent_page.action.send").disabled).toBe(true);
  });
});

function build_state(overrides: Partial<AgentPageState> = {}): AgentPageState {
  return {
    state: "idle",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "**变更方案**",
        createdAt: 1,
        complete: false,
      },
    ],
    tool_statuses: [],
    skills: [{ name: "glossary-audit", description: "审校术语" }],
    input: "@",
    selected_skill: null,
    skill_menu_open: true,
    loading: false,
    error: false,
    update_input: vi.fn(),
    select_skill: vi.fn(),
    clear_skill: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

function get_button(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (button === undefined) throw new Error(`缺少按钮：${text}`);
  return button;
}
