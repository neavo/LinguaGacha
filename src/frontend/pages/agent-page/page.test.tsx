import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentAssistantMessageParts, AgentEntryStatus } from "@shared/agent";
import type { useAgentSession as UseAgentSessionFunction } from "@frontend/app/session/agent/agent-session-context";

type AgentPageState = ReturnType<typeof UseAgentSessionFunction>;

const page_state = vi.hoisted(() => ({ current: {} as AgentPageState }));
/** 用真实 hook 返回形状驱动 runtime owner 迁移，不复制 store 内部实现。 */
const runtime_state = vi.hoisted(() => ({
  current: { revision: 0, owner: null as "task" | "agent" | null },
}));
const desktop_state = vi.hoisted(() => ({
  current: {
    project_snapshot: { loaded: true as boolean, path: "E:/demo/demo.lg" },
    project_session_status: "ready",
  },
}));
const quality_query_state = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  last_args: null as Record<string, unknown> | null,
}));
const quality_statistics_state = vi.hoisted(() => ({
  current: {
    entry_ids: [] as string[],
    hits_by_entry_id: {} as Record<string, number>,
  },
}));
const push_toast = vi.hoisted(() => vi.fn());
/** 模拟模型页更新后的共享选择快照，验证同一会话无需重建即可刷新容量。 */
const model_agent_limits = vi.hoisted(() => ({
  context_window: 288_000,
  max_output_tokens: 32_000,
}));
const resize_observers = new Set<TestResizeObserver>();

/** happy-dom 不主动分发内容尺寸变化，测试显式触发真实观察回调。 */
class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resize_observers.add(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    resize_observers.delete(this);
  }
  takeRecords(): ResizeObserverEntry[] {
    return [];
  }
  notify(): void {
    this.callback([], this);
  }
}

function notify_resize_observers(): void {
  for (const observer of resize_observers) observer.notify();
}

/** 等待用户滚动后的帧末位置裁决，不用固定时长猜测浏览器调度。 */
function next_animation_frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

type ScrollMetrics = {
  top: number;
  height: number;
  viewport: number;
};

/** 用可变布局数据模拟浏览器的滚动范围与 scrollTop 夹取。 */
function install_scroll_metrics(target: HTMLElement, metrics: ScrollMetrics): void {
  Object.defineProperties(target, {
    scrollHeight: { configurable: true, get: () => metrics.height },
    clientHeight: { configurable: true, get: () => metrics.viewport },
    scrollTop: {
      configurable: true,
      get: () => metrics.top,
      set: (value: number) => {
        metrics.top = Math.max(0, Math.min(value, metrics.height - metrics.viewport));
      },
    },
  });
}

vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentSession: () => page_state.current,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => desktop_state.current,
  useRuntimeSnapshot: () => runtime_state.current,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast }),
}));
vi.mock("@frontend/app/session/quality-rule-statistics-context", () => ({
  useQualityRuleStatistics: () => quality_statistics_state.current,
}));
vi.mock("@frontend/features/quality-rule-editor/use-quality-rule-query", () => ({
  useQualityRuleQuery: (args: {
    project_path: string;
    default_slice: unknown;
    normalize_slice: (
      slice: { entries: Array<Record<string, unknown>> },
      revision: number,
    ) => unknown;
  }) => {
    quality_query_state.last_args = args as unknown as Record<string, unknown>;
    return {
      quality_slice:
        args.project_path === ""
          ? args.default_slice
          : args.normalize_slice({ entries: quality_query_state.entries }, 1),
      quality_loaded: args.project_path !== "",
      refresh_quality_rule_snapshot: vi.fn(),
    };
  },
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
            agent_limits: { ...model_agent_limits },
            thinking_level: "OFF",
            available_thinking_levels: [],
          },
        ],
      },
      loading: false,
      updating: false,
      select_model: vi.fn(async () => undefined),
      update_thinking_level: vi.fn(async () => undefined),
    }),
  };
});
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

import { AgentPage } from "./page";

describe("AgentPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    resize_observers.clear();
    runtime_state.current = { revision: 0, owner: null };
    desktop_state.current = {
      project_snapshot: { loaded: true, path: "E:/demo/demo.lg" },
      project_session_status: "ready",
    };
    quality_query_state.entries = [];
    quality_query_state.last_args = null;
    quality_statistics_state.current = {
      entry_ids: [],
      hits_by_entry_id: {},
    };
    push_toast.mockReset();
    model_agent_limits.context_window = 288_000;
    model_agent_limits.max_output_tokens = 32_000;
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    resize_observers.clear();
    vi.unstubAllGlobals();
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

  it("空会话建议写入草稿而不直接发送", async () => {
    const send = vi.fn(async () => undefined);
    const view = await render_page({ entries: [], send });
    const suggestions = [...view.querySelectorAll<HTMLButtonElement>(".agent-page__suggestion")];
    const literal_suggestion = suggestions.find((button) => {
      return button.querySelector(".agent-mention-token") === null;
    });
    const skill_suggestion = suggestions.find((button) => {
      return button.querySelector(".agent-mention-token") !== null;
    });
    const editor = view.querySelector<HTMLElement>(".cm-content");
    const submit = get_button_by_label(view, "agent_page.action.send");
    const literal_text = literal_suggestion?.textContent?.trim();
    const skill_text = skill_suggestion?.textContent?.trim();
    if (literal_suggestion === undefined || literal_text === undefined) {
      throw new Error("缺少普通起始任务。");
    }
    if (skill_suggestion === undefined || skill_text === undefined) {
      throw new Error("缺少技能起始任务。");
    }
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__reset")?.disabled).toBe(true);

    await act(async () => literal_suggestion.click());
    expect(send).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith({ text: literal_text, attachments: [] });

    await act(async () => skill_suggestion.click());
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith({ text: skill_text, attachments: [] });

    await render_page();
    expect(view.querySelectorAll(".agent-page__suggestion")).toHaveLength(0);
  });

  it("按当前工程接入规范术语，未加载工程与读取失败不阻断能力和发送", async () => {
    quality_query_state.entries = [
      {
        entry_id: "alice",
        src: " Alice ",
        dst: " 爱丽丝 ",
        info: " 主角 ",
        case_sensitive: false,
      },
    ];
    quality_statistics_state.current = {
      entry_ids: ["alice"],
      hits_by_entry_id: { alice: 7 },
    };
    const send = vi.fn(async () => undefined);
    const view = await render_page({ entries: [], send });
    const editor = EditorView.findFromDOM(view.querySelector<HTMLElement>(".cm-content")!);
    if (editor === null) throw new Error("缺少 Composer");
    await act(async () =>
      editor.dispatch({
        changes: { from: 0, insert: "@" },
        selection: EditorSelection.cursor(1),
      }),
    );
    expect(
      view.querySelector('[aria-labelledby="agent-mention-terms-label"]')?.textContent,
    ).toContain("Alice爱丽丝 · 主角");
    expect(quality_query_state.last_args).toMatchObject({
      rule_type: "glossary",
      project_path: "E:/demo/demo.lg",
      session_ready: true,
    });

    const on_load_error = quality_query_state.last_args?.["on_load_error"];
    if (typeof on_load_error !== "function") throw new Error("缺少术语错误出口");
    await act(async () => on_load_error(new Error("load failed")));
    expect(push_toast).toHaveBeenCalledWith("error", "agent_page.error.terms_load");

    desktop_state.current = {
      project_snapshot: { loaded: false, path: "" },
      project_session_status: "ready",
    };
    await render_page({ entries: [], send });
    expect(quality_query_state.last_args).toMatchObject({ project_path: "" });
    expect(view.querySelector('[aria-labelledby="agent-mention-terms-label"]')).toBeNull();
  });

  it("恢复失败时显示单一重试入口并重新连接", async () => {
    const reconnect = vi.fn();
    const view = await render_page({ transport: "restore_failed", reconnect });
    const alert = view.querySelector<HTMLElement>('[role="alert"]');
    const retry_button = [...view.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "app.action.retry",
    );
    if (retry_button === undefined) throw new Error("缺少恢复重试按钮");

    expect(alert).not.toBeNull();
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__model-trigger")?.disabled).toBe(
      true,
    );
    await act(async () => retry_button.click());
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("断线状态只在连接提示中公开", async () => {
    const view = await render_page({ transport: "disconnected" });

    expect(view.querySelector('.agent-page__connection-status[role="status"]')).not.toBeNull();
    expect(view.querySelector('.sr-only[role="status"]')).toBeNull();
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

  it("外层接管同步阻断同一批尺寸变化，回到底端后恢复追随", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 600, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);

    scroll.height = 1_100;
    await act(async () => notify_resize_observers());
    expect(scroll.top).toBe(700);

    await act(async () => {
      conversation.dispatchEvent(new Event("wheel", { bubbles: true }));
      await next_animation_frame();
    });
    expect(find_button_by_text(view, "agent_page.action.return_latest")).toBeUndefined();

    scroll.top = 100;
    scroll.height = 1_200;
    await act(async () => {
      conversation.dispatchEvent(new Event("scroll"));
      notify_resize_observers();
    });
    expect(scroll.top).toBe(800);
    expect(find_button_by_text(view, "agent_page.action.return_latest")).toBeUndefined();

    scroll.top = 100;
    await act(async () => {
      conversation.dispatchEvent(new Event("wheel", { bubbles: true }));
      await next_animation_frame();
      notify_resize_observers();
    });
    expect(scroll.top).toBe(100);
    expect(find_button_by_text(view, "agent_page.action.return_latest")).toBeDefined();

    scroll.top = 800;
    await act(async () => {
      conversation.dispatchEvent(new Event("wheel", { bubbles: true }));
      await next_animation_frame();
      scroll.height = 1_300;
      notify_resize_observers();
    });
    expect(scroll.top).toBe(900);
    expect(find_button_by_text(view, "agent_page.action.return_latest")).toBeUndefined();
  });

  it("思考块局部暂停不影响外层追随，外层接管才显示回到底部", async () => {
    const render_thinking = (first: string, second: string) =>
      render_page({
        state: "running",
        entries: [
          user_entry("user-thinking", "开始检查", "running", 0, null),
          assistant_parts_entry(
            "assistant-thinking-1",
            [{ kind: "thinking", text: first }],
            "running",
            1,
          ),
          assistant_parts_entry(
            "assistant-thinking-2",
            [{ kind: "thinking", text: second }],
            "running",
            2,
          ),
        ],
      });
    const view = await render_thinking("第一步\n第二步", "甲\n乙");
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    const thinking = [...view.querySelectorAll<HTMLPreElement>(".agent-thinking-entry pre")];
    if (conversation === null || thinking.length !== 2) throw new Error("缺少嵌套滚动容器");
    const outer_scroll = { top: 600, height: 1_000, viewport: 400 };
    const thinking_scrolls: [ScrollMetrics, ScrollMetrics] = [
      { top: 240, height: 480, viewport: 240 },
      { top: 240, height: 480, viewport: 240 },
    ];
    install_scroll_metrics(conversation, outer_scroll);
    thinking.forEach((content, index) => {
      const metrics = thinking_scrolls[index];
      if (metrics !== undefined) install_scroll_metrics(content, metrics);
    });

    thinking_scrolls[0].top = 80;
    thinking_scrolls[1].top = 120;
    await act(async () => {
      thinking[0]?.dispatchEvent(new Event("wheel", { bubbles: true }));
      thinking[1]?.dispatchEvent(new Event("wheel", { bubbles: true }));
      await next_animation_frame();
    });
    expect(find_button_by_text(view, "agent_page.action.return_latest")).toBeUndefined();

    await render_thinking("第一步\n第二步\n第三步", "甲\n乙\n丙");
    outer_scroll.height = 1_100;
    await act(async () => notify_resize_observers());
    expect(thinking_scrolls.map(({ top }) => top)).toEqual([80, 120]);
    expect(outer_scroll.top).toBe(700);

    outer_scroll.top = 100;
    await act(async () => {
      conversation.dispatchEvent(new Event("wheel", { bubbles: true }));
      await next_animation_frame();
    });

    const latest = find_button_by_text(view, "agent_page.action.return_latest");
    await act(async () => latest?.click());
    expect(outer_scroll.top).toBe(700);
    expect(thinking_scrolls.map(({ top }) => top)).toEqual([240, 240]);
    expect(find_button_by_text(view, "agent_page.action.return_latest")).toBeUndefined();
  });

  it("按运行态切换提交按钮并允许停止", async () => {
    const stop = vi.fn();
    const view = await render_page({ state: "running", stop });
    await act(async () => get_button_by_label(view, "agent_page.action.stop").click());
    expect(stop).toHaveBeenCalledOnce();
  });

  it("workspace_apply 运行期间把不可停止状态传给操作栏", async () => {
    const stop = vi.fn();
    const view = await render_page({
      state: "running",
      stop,
      entries: [
        user_entry("user-1", "写入", "running", 0, null),
        {
          kind: "tool_call",
          id: "apply-1",
          toolName: "workspace_apply",
          input: "{}",
          status: "running",
          output: null,
          createdAt: 1,
        },
      ],
    });
    const submit = get_button_by_label(view, "agent_page.action.applying");

    expect(submit.disabled).toBe(true);
    await act(async () => submit.click());
    expect(stop).not.toHaveBeenCalled();
  });

  it("压缩失败只显示原位继续入口并调用统一命令", async () => {
    const continue_session = vi.fn(async () => undefined);
    const view = await render_page({
      entries: [
        user_entry("user-1", "初次检查", "success", 0, 1_000),
        {
          kind: "context_compaction",
          id: "compaction-1",
          status: "error",
          createdAt: 1_500,
        },
        user_entry("user-2", "继续检查", "error", 2_000, 3_000),
        assistant_entry("assistant-1", "部分结果", "error", 2_500),
      ],
      continue: continue_session,
    });
    const continue_entries = [...view.querySelectorAll<HTMLButtonElement>(".agent-continue-entry")];
    const compaction_continue = continue_entries.find((button) =>
      button.textContent?.includes("agent_page.compaction.error"),
    );
    const message_continue = continue_entries.find((button) =>
      button.textContent?.includes("app.error.model.provider_failed.message"),
    );
    expect(compaction_continue?.disabled).toBe(false);
    expect(message_continue).toBeUndefined();
    expect(view.querySelector(".agent-message-actions")).toBeNull();
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__submit")?.disabled).toBe(true);

    await act(async () => compaction_continue?.click());

    expect(continue_session).toHaveBeenCalledOnce();
  });

  it("停止命令失败时保留运行态并显示错误 Toast", async () => {
    const stop = vi.fn(() => Promise.reject(new Error("offline")));
    const view = await render_page({ state: "running", stop });
    await act(async () => {
      get_button_by_label(view, "agent_page.action.stop").click();
      await vi.waitFor(() =>
        expect(push_toast).toHaveBeenCalledWith("error", "agent_page.error.stop"),
      );
    });

    expect(get_button_by_label(view, "agent_page.action.stop").disabled).toBe(false);
  });

  it("发送命令失败时保留操作栏并显示错误 Toast", async () => {
    const send = vi.fn(() => Promise.reject(new Error("offline")));
    const view = await render_page({ entries: [], send });
    const editor = get_editor(view);
    await act(async () => {
      editor.dispatch({ changes: { from: 0, insert: "继续处理" } });
    });
    await act(async () => {
      get_button_by_label(view, "agent_page.action.send").click();
      await vi.waitFor(() => expect(push_toast).toHaveBeenCalledOnce());
    });

    expect(push_toast).toHaveBeenCalledWith("error", "agent_page.error.send");
    expect(view.querySelector(".agent-composer__error")).toBeNull();
  });

  it("暂停队列通过 Composer 空继续或追加消息后继续", async () => {
    const continue_session = vi.fn(async () => undefined);
    const view = await render_page({
      continue: continue_session,
      inputQueue: {
        paused: true,
        canSendNow: true,
        items: [
          {
            id: "queue-1",
            text: "已有消息",
            attachments: [],
            status: "queued",
            createdAt: 1,
          },
        ],
      },
    });

    await act(async () => get_button_by_label(view, "agent_page.action.continue").click());
    expect(continue_session).toHaveBeenLastCalledWith(undefined);

    await act(async () => {
      get_editor(view).dispatch({ changes: { from: 0, insert: "追加消息" } });
    });
    await vi.waitFor(() =>
      expect(get_button_by_label(view, "agent_page.action.continue")).toBeDefined(),
    );
    await act(async () => get_button_by_label(view, "agent_page.action.continue").click());
    expect(continue_session).toHaveBeenLastCalledWith({ text: "追加消息", attachments: [] });
  });

  it("失败轮次通过继续入口续跑并保留当前草稿", async () => {
    const send = vi.fn(async () => undefined);
    const continue_session = vi.fn(async () => undefined);
    const view = await render_page({
      entries: [user_entry("user-error", "重新检查术语", "error", 1, 2)],
      send,
      continue: continue_session,
    });
    const editor = get_editor(view);
    await act(async () => {
      editor.dispatch({ changes: { from: 0, insert: "正在编辑的新任务" } });
    });
    const continue_button = view.querySelector<HTMLButtonElement>(".agent-continue-entry");
    if (continue_button === null) throw new Error("缺少轮次继续按钮");
    await act(async () => continue_button.click());

    expect(continue_session).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe("正在编辑的新任务");
  });

  it("成功轮次不显示回合重试，输入编辑器承接重新运行", async () => {
    const view = await render_page({
      entries: [
        user_entry("user-write", "修改工程", "success", 0, 3),
        workspace_apply_entry("apply-1"),
        assistant_entry("assistant-write", "修改完成", "success", 2),
      ],
    });

    expect(view.querySelector(".agent-round-footer button")).toBeNull();
    expect(view.querySelector(".agent-composer--inline")).toBeNull();
  });

  it("历史消息原位编辑直接保存输入与输出", async () => {
    const reviseLatestRound = vi.fn(async () => undefined);
    const entries = [
      user_entry("user-write", "原输入", "success", 0, 3),
      workspace_apply_entry("apply-1"),
      assistant_entry("assistant-write", "原输出", "success", 2),
    ];
    const ordinary_input = build_state().input;
    ordinary_input.read_draft = () => ({ text: "普通草稿", attachments: [] });
    const view = await render_page({
      entries,
      reviseLatestRound,
      input: ordinary_input,
    });

    const user_edit = [
      ...view.querySelectorAll<HTMLButtonElement>(
        ".agent-message-frame--user .agent-message-actions button",
      ),
    ].find((button) => button.textContent === "agent_page.action.edit");
    if (user_edit === undefined) throw new Error("缺少 user 编辑按钮");
    await act(async () => user_edit.click());
    const user_editor = get_editor(view);
    const bottom_content = view.querySelector<HTMLElement>(
      ".agent-composer:not(.agent-composer--inline) .cm-content",
    );
    if (bottom_content === null) throw new Error("缺少普通 Composer");
    expect(EditorView.findFromDOM(bottom_content)?.state.doc.toString()).toBe("普通草稿");
    await act(async () =>
      user_editor.dispatch({
        changes: { from: 0, to: user_editor.state.doc.length, insert: "新输入" },
      }),
    );
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>(".agent-composer--inline .agent-composer__inline-submit")
        ?.click(),
    );
    expect(reviseLatestRound).toHaveBeenCalledWith("user-write", {
      text: "新输入",
      attachments: [],
    });
    expect(ordinary_input.replace_history).toHaveBeenCalledWith("原输入", "新输入");
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    reviseLatestRound.mockClear();
    const assistant_edit = [
      ...view.querySelectorAll<HTMLButtonElement>(
        ".agent-message-frame--assistant .agent-message-actions button",
      ),
    ].find((button) => button.textContent === "agent_page.action.edit");
    if (assistant_edit === undefined) throw new Error("缺少 assistant 编辑按钮");
    await act(async () => assistant_edit.click());
    const assistant_editor = get_editor(view);
    expect(view.querySelector(".agent-composer--inline .agent-composer__image-trigger")).toBeNull();
    expect(view.querySelector(".agent-composer--inline .agent-composer__model-trigger")).toBeNull();
    await act(async () =>
      assistant_editor.dispatch({
        changes: { from: 0, to: assistant_editor.state.doc.length, insert: "新输出" },
      }),
    );
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>(".agent-composer--inline .agent-composer__inline-submit")
        ?.click(),
    );
    expect(reviseLatestRound).toHaveBeenCalledWith("assistant-write", {
      text: "新输出",
      attachments: [],
    });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("原位输入修改受理失败时保留编辑内容并显示修改错误", async () => {
    const reviseLatestRound = vi.fn(() => Promise.reject(new Error("offline")));
    const view = await render_page({
      entries: [user_entry("user-1", "原输入", "success", 0, 1)],
      reviseLatestRound,
    });

    const edit = [
      ...view.querySelectorAll<HTMLButtonElement>(
        ".agent-message-frame--user .agent-message-actions button",
      ),
    ].find((button) => button.textContent === "agent_page.action.edit");
    if (edit === undefined) throw new Error("缺少 user 编辑按钮");
    await act(async () => edit.click());
    const editor = get_editor(view);
    await act(async () => {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: "新输入" },
      });
    });
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>(".agent-composer--inline .agent-composer__inline-submit")
        ?.click(),
    );
    await vi.waitFor(() =>
      expect(view.querySelector(".agent-inline-editor__error")).not.toBeNull(),
    );

    expect(get_editor(view).state.doc.toString()).toBe("新输入");
    expect(view.querySelector(".agent-inline-editor__error")?.textContent).toContain(
      "agent_page.error.edit",
    );
  });

  it("队列项原位修改并调用队列更新入口", async () => {
    const updateQueuedMessage = vi.fn(async () => undefined);
    const queued = {
      id: "queue-1",
      text: "原排队消息",
      attachments: [],
      status: "queued" as const,
      createdAt: 1,
    };
    const view = await render_page({
      inputQueue: { paused: false, canSendNow: true, items: [queued] },
      updateQueuedMessage,
    });

    const edit = view.querySelector<HTMLButtonElement>(
      'button[aria-label="agent_page.action.edit"]',
    );
    if (edit === null) throw new Error("缺少队列编辑按钮");
    await act(async () => edit.click());
    const editor = get_editor(view);
    await act(async () =>
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: "新排队消息" },
      }),
    );
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>(".agent-composer--inline .agent-composer__inline-submit")
        ?.click(),
    );

    expect(updateQueuedMessage).toHaveBeenCalledWith("queue-1", {
      text: "新排队消息",
      attachments: [],
    });
  });

  it("新任务先确认，取消不调用，确认期间锁定并在成功后关闭", async () => {
    let resolve_reset!: () => void;
    const reset = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolve_reset = resolve;
        }),
    );
    const view = await render_page({ reset });
    const reset_button = view.querySelector<HTMLButtonElement>(".agent-composer__reset");
    if (reset_button === null) throw new Error("缺少新任务按钮");

    await act(async () => reset_button.click());
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
    await act(async () => get_portal_cancel_button().click());
    expect(reset).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await act(async () => reset_button.click());
    const confirm = get_portal_action_button();
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(reset).toHaveBeenCalledOnce();
    await render_page({ reset, command: "reset" });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
    expect(get_portal_cancel_button().disabled).toBe(true);

    await act(async () => resolve_reset());
    await act(async () =>
      vi.waitFor(() =>
        expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull(),
      ),
    );
  });

  it("重置失败后保留确认框供取消或重试", async () => {
    const reset = vi.fn(() => Promise.reject(new Error("offline")));
    const view = await render_page({ reset });
    const reset_button = view.querySelector<HTMLButtonElement>(".agent-composer__reset");
    if (reset_button === null) throw new Error("缺少新任务按钮");
    await act(async () => reset_button.click());
    await act(async () => get_portal_action_button().click());
    expect(reset).toHaveBeenCalledOnce();
    expect(push_toast).toHaveBeenCalledWith("error", "agent_page.error.reset");
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
  });
});

function build_state(overrides: Partial<AgentPageState> = {}): AgentPageState {
  const skills = [
    {
      name: "quality-rule-create",
      displayDescriptions: {
        "zh-CN": "创建质量规则",
        "en-US": "Create quality rules",
        "de-DE": "Qualitätsregeln erstellen",
      },
    },
    {
      name: "quality-rule-review",
      displayDescriptions: {
        "zh-CN": "审校质量规则",
        "en-US": "Review quality rules",
        "de-DE": "Qualitätsregeln prüfen",
      },
    },
    {
      name: "translation-review",
      displayDescriptions: {
        "zh-CN": "审查译文",
        "en-US": "Review translations",
        "de-DE": "Übersetzungen prüfen",
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
    entries: [
      user_entry("user-1", "开始", "success", 0, 1),
      assistant_entry("assistant-1", "**变更方案**", "success", 1),
    ],
    skills,
    inputQueue: { paused: false, canSendNow: false, items: [] },
    taskProgress: overrides.taskProgress ?? [],
    contextTokens: overrides.contextTokens ?? null,
    transport: "ready",
    command: null,
    input: {
      revision: 0,
      read_draft: () => ({ text: "", attachments: [] }),
      write_draft: vi.fn(),
      read_history: () => [],
      replace_history: vi.fn(),
    },
    send: vi.fn(async () => undefined),
    reviseLatestRound: vi.fn(async () => undefined),
    updateQueuedMessage: vi.fn(async () => undefined),
    deleteQueuedMessage: vi.fn(async () => undefined),
    reorderQueuedMessages: vi.fn(async () => undefined),
    sendQueuedMessage: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    stop: vi.fn(),
    reset: vi.fn(async () => undefined),
    reconnect: vi.fn(),
    ...overrides,
  };
}

function user_entry(
  id: string,
  text: string,
  status: AgentEntryStatus,
  createdAt: number,
  endedAt: number | null,
) {
  return {
    kind: "user_message" as const,
    id,
    delivery: "round" as const,
    text,
    attachments: [],
    status,
    createdAt,
    endedAt,
  };
}

function assistant_entry(id: string, text: string, status: AgentEntryStatus, createdAt: number) {
  return assistant_parts_entry(id, [{ kind: "text", text }], status, createdAt);
}

/** 构造最新轮次内已经成功落盘的 apply 条目。 */
function workspace_apply_entry(id: string) {
  return {
    kind: "tool_call" as const,
    id,
    toolName: "workspace_apply",
    input: "{}",
    status: "success" as const,
    output: "{}",
    createdAt: 1,
  };
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

function get_button_by_label(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`缺少按钮：${label}`);
  return button;
}

function find_button_by_text(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

function get_editor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) throw new Error("缺少 CodeMirror 编辑器");
  return editor;
}

function get_portal_action_button(): HTMLButtonElement {
  const dialog = document.body.querySelector('[data-slot="alert-dialog-content"]');
  const button = dialog?.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-primary-action"]',
  );
  if (button === null || button === undefined) throw new Error("缺少弹窗确认按钮");
  return button;
}

function get_portal_cancel_button(): HTMLButtonElement {
  const dialog = document.body.querySelector('[data-slot="alert-dialog-content"]');
  const button = dialog?.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]');
  if (button === null || button === undefined) throw new Error("缺少弹窗取消按钮");
  return button;
}
