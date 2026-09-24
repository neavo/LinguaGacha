vi.mock("./use-agent-mention-files", () => ({
  useAgentMentionFiles: () => ({ files: [], status: "idle" }),
}));
import type { AgentInputRequest } from "@frontend/app/navigation/types";
import { AgentInputDraft } from "@frontend/app/session/agent/agent-input-draft";
import { uploaded_file } from "../../../test/agent-upload-fixture";
vi.mock("@frontend/app/session/batch-translation/batch-translation-session-context", () => ({
  useBatchTranslationSession: () => ({
    batch_translation_task: { translation_task_metrics: { active: false } },
  }),
}));
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { ModelThinkingLevel } from "@domain/model";
import {
  AGENT_INPUT_QUEUE_LIMIT,
  type AgentAssistantMessageParts,
  type AgentEntryStatus,
} from "@shared/agent";
import type {
  AgentControlsSlice,
  AgentInputSession,
  AgentTodoSlice,
  AgentQueueSlice,
  AgentSessionActions,
  AgentSkillsSlice,
  AgentTimelineSlice,
} from "@frontend/app/session/agent/agent-session-store";

type AgentPageState = AgentTimelineSlice &
  AgentControlsSlice &
  AgentQueueSlice &
  AgentTodoSlice &
  AgentSkillsSlice &
  AgentSessionActions & { input: AgentInputSession };

const navigation = vi.hoisted(() => ({
  agent_input_request: null as AgentInputRequest | null,
  clear_agent_input_request: vi.fn(),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => navigation,
}));
const page_state = vi.hoisted(() => ({ current: {} as AgentPageState }));
/** 用真实 hook 返回形状驱动 runtime owner 迁移，不复制 store 内部实现。 */
const runtime_state = vi.hoisted(() => ({
  current: { revision: 0, owner: null as "batch_translation" | "agent" | "model_test" | null },
}));
const push_toast = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_blob: async () => new Blob([], { type: "image/png" }),
  api_file_url: (path: string) => `http://localhost${path}`,
  api_upload: async (_path: string, file: File) => uploaded_file(`webp-${file.name}`),
}));
const model_thinking_state = vi.hoisted(() => ({
  thinking_level: "OFF" as ModelThinkingLevel,
  available_thinking_levels: [] as ModelThinkingLevel[],
}));
const model_selection_commands = vi.hoisted(() => ({
  select_model: vi.fn(async () => undefined),
}));
const resize_observers = new Set<TestResizeObserver>();

/** happy-dom 不主动分发内容尺寸变化，测试显式推进真实观察回调。 */
class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly targets = new Set<Element>();

  /** 保留真实观察回调，并登记到测试的统一通知入口。 */
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resize_observers.add(this);
  }

  /** 登记需要接收尺寸通知的元素。 */
  observe(target: Element): void {
    this.targets.add(target);
  }
  /** 移除指定元素的尺寸订阅。 */
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  /** 解除该观察器在测试中的全部通知来源。 */
  disconnect(): void {
    resize_observers.delete(this);
  }
  /** 按被观察元素定向推进尺寸变化。 */
  notify(target?: Element): void {
    if (target !== undefined && !this.targets.has(target)) return;
    this.callback([], this);
  }
}

/** 通知实际订阅目标的观察器。 */
function notify_resize_observers(target?: Element): void {
  for (const observer of resize_observers) observer.notify(target);
}

/** 等待合帧布局跟随完成。 */
function next_animation_frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

type ScrollMetrics = {
  top: number;
  height: number;
  viewport: number;
};

/** 按浏览器夹取规则从测试几何计算底端。 */
function scroll_end(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.height - metrics.viewport);
}

/** 用可变布局数据模拟浏览器的滚动范围与 scrollTop 夹取。 */
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

vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentTokenSpeed: () => null,
  useAgentTimeline: () => ({ entries: page_state.current.entries }),
  useAgentControls: () => ({
    state: page_state.current.state,
    approvalMode: page_state.current.approvalMode,
    pendingDecision: page_state.current.pendingDecision,
    context: page_state.current.context,
    usage: page_state.current.usage,
    transport: page_state.current.transport,
    command: page_state.current.command,
  }),
  useAgentQueue: () => ({ inputQueue: page_state.current.inputQueue }),
  useAgentTodo: () => ({ todos: page_state.current.todos }),
  useAgentSkills: () => ({ skills: page_state.current.skills }),
  useAgentInput: () => page_state.current.input,
  useAgentDecisionCountdown: () => null,
  useAgentSessionActions: () => page_state.current,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => runtime_state.current,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast }));
vi.mock("@frontend/features/model-selection/use-model-selection", async (import_original) => {
  const actual =
    await import_original<
      typeof import("@frontend/features/model-selection/use-model-selection")
    >();
  return {
    ...actual,
    useModelSelection: () => ({
      snapshot: {
        model_selection: { translation: "preset", agent: "agent", agent_batch_translation: null },
        models: [
          {
            id: "agent",
            type: "CUSTOM_OPENAI",
            name: "Agent Model",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
            thinking_level: model_thinking_state.thinking_level,
            available_thinking_levels: model_thinking_state.available_thinking_levels,
          },
        ],
      },
      loading: false,
      updating: false,
      select_model: model_selection_commands.select_model,
    }),
  };
});
vi.mock("@frontend/app/session/translation-export/translation-export-context", () => ({
  useTranslationExport: () => ({ can_request_export: true, request_export: vi.fn() }),
}));
vi.mock("@frontend/app/session/project-translation-stats-context", () => ({
  useProjectTranslationStats: () => null,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));
vi.mock("@frontend/app/appearance/appearance-context", () => ({
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
    push_toast.mockReset();
    navigation.agent_input_request = null;
    navigation.clear_agent_input_request.mockReset();
    model_thinking_state.thinking_level = "OFF";
    model_thinking_state.available_thinking_levels = [];
    model_selection_commands.select_model.mockClear();
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
    // 真实 Store 在草稿 revision 变化前保留输入端口；普通运行态更新继续消费同一份草稿。
    const previous_input = root === null ? undefined : page_state.current.input;
    page_state.current = build_state(overrides);
    page_state.current.input = overrides.input ?? previous_input ?? page_state.current.input;
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () =>
      root?.render(
        <StrictMode>
          <TooltipProvider>
            <AgentPage is_sidebar_collapsed={false} />
          </TooltipProvider>
        </StrictMode>,
      ),
    );
    return container;
  }

  it("导航替换草稿和附件、聚焦选中占位文字，重渲染不重复覆盖", async () => {
    const input = build_state().input;
    input.draft.write({ text: "原草稿", attachments: [uploaded_file("old")] });
    const text = "安装：[链接]";
    navigation.agent_input_request = {
      text,
      mode: "replace",
      selection: { from: 3, to: text.length },
    };
    const send = vi.fn();
    const view = await render_page({ input, send });
    const editor = EditorView.findFromDOM(view.querySelector(".cm-editor")!)!;
    expect(input.draft.read()).toEqual({ text, attachments: [] });
    expect(
      editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to),
    ).toBe("[链接]");
    expect(editor.hasFocus).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(navigation.clear_agent_input_request).toHaveBeenCalledTimes(1);
    await act(async () =>
      editor.dispatch({ changes: { from: 0, to: text.length, insert: "用户已修改" } }),
    );
    await render_page({ input, send });
    expect(input.draft.read().text).toBe("用户已修改");
  });

  it.each(["empty", "text", "attachment"] as const)(
    "审校导航按实际草稿决定是否填充：%s",
    async (kind) => {
      const input = build_state().input;
      const original = {
        text: kind === "text" ? "已有正文" : "",
        attachments: kind === "attachment" ? [uploaded_file("old")] : [],
      };
      input.draft.write(original);
      navigation.agent_input_request = { text: "审校请求", mode: "if-empty" };
      await render_page({ input });
      expect(input.draft.read()).toEqual(
        kind === "empty" ? { text: "审校请求", attachments: [] } : original,
      );
      expect(navigation.clear_agent_input_request).toHaveBeenCalledTimes(1);
    },
  );

  it("会话恢复完成后才消费导航请求", async () => {
    const input = build_state().input;
    navigation.agent_input_request = { text: "安装请求", mode: "replace" };
    await render_page({ input, transport: "restoring" });
    expect(input.draft.read().text).toBe("");
    expect(navigation.clear_agent_input_request).not.toHaveBeenCalled();
    await render_page({ input, transport: "ready" });
    expect(input.draft.read().text).toBe("安装请求");
  });

  it("输入锁释放后才消费导航请求", async () => {
    const input = build_state().input;
    input.draft.write({ text: "原草稿", attachments: [] });
    navigation.agent_input_request = { text: "安装请求", mode: "replace" };
    await render_page({ input, command: "reset" });
    expect(input.draft.read().text).toBe("原草稿");
    expect(navigation.clear_agent_input_request).not.toHaveBeenCalled();
    await render_page({ input, command: null });
    expect(input.draft.read().text).toBe("安装请求");
    expect(navigation.clear_agent_input_request).toHaveBeenCalledTimes(1);
  });

  it("页面留白、消息区与输入框拖入图片均只追加一次", async () => {
    const input = build_state().input;
    const view = await render_page({ input, state: "running" });
    for (const selector of [".agent-page", ".agent-page__conversation", ".cm-content"]) {
      const target = view.querySelector(selector)!;
      await drop_image(target, "page.png");
    }
    expect(input.draft.read()).toEqual({
      text: "",
      attachments: Array.from({ length: 3 }, () => uploaded_file("webp-page.png")),
    });
  });

  it("原位编辑时整页暂停接收，局部图片只写入编辑消息", async () => {
    const input = build_state().input;
    const reviseLatestRound = vi.fn(async () => undefined);
    const view = await render_page({ input, reviseLatestRound });
    const edit = [
      ...view.querySelectorAll<HTMLButtonElement>(
        ".agent-message-frame--user .agent-message-actions button",
      ),
    ].find((button) => button.textContent === "agent_page.action.edit")!;
    await act(async () => edit.click());
    await drop_image(view.querySelector(".agent-page")!, "ignored.png");
    const inline_editor = view.querySelector(".agent-composer--inline")!;
    const over = new DragEvent("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", {
      value: { types: ["Files"], dropEffect: "none" },
    });
    await act(async () => inline_editor.dispatchEvent(over));
    expect(over.dataTransfer?.dropEffect).toBe("copy");
    await drop_image(inline_editor, "inline.png");
    expect(input.draft.read()).toEqual({ text: "", attachments: [] });
    await act(async () =>
      view.querySelector<HTMLButtonElement>(".agent-composer__inline-submit")!.click(),
    );
    expect(reviseLatestRound).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        attachments: [uploaded_file("webp-inline.png")],
      }),
    );
  });

  it("空会话建议写入草稿而不直接发送", async () => {
    const send = vi.fn(async () => undefined);
    const view = await render_page({ entries: [], send });
    const suggestion = view.querySelector<HTMLButtonElement>(".agent-page__suggestion");
    const editor = view.querySelector<HTMLElement>(".cm-content");
    const submit = get_button_by_label(view, "agent_page.action.send");
    const suggestion_text = suggestion?.textContent?.trim();
    if (suggestion === null || suggestion_text === undefined) throw new Error("缺少起始任务。");
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__reset")?.disabled).toBe(true);

    await act(async () => suggestion.click());
    expect(send).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith({ text: suggestion_text, attachments: [] });

    await render_page();
    expect(view.querySelectorAll(".agent-page__suggestion")).toHaveLength(0);
  });

  it("模型思考关闭时，新会话首条消息需确认后才发送", async () => {
    model_thinking_state.available_thinking_levels = ["OFF"];
    const send = vi.fn(async () => undefined);
    const view = await render_page({ entries: [], send });
    const editor = get_editor(view);
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "执行任务" } }));

    await act(async () => get_button_by_label(view, "agent_page.action.send").click());
    expect(send).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();

    await act(async () => get_portal_cancel_button().click());
    expect(send).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe("执行任务");

    await act(async () => get_button_by_label(view, "agent_page.action.send").click());
    await act(async () => get_portal_action_button().click());
    expect(send).toHaveBeenCalledWith({ text: "执行任务", attachments: [] });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("已有 Agent 对话在思考关闭时不重复弹出确认", async () => {
    model_thinking_state.available_thinking_levels = ["OFF"];
    const send = vi.fn(async () => undefined);
    const view = await render_page({ send });
    const editor = get_editor(view);
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "继续任务" } }));

    await act(async () => get_button_by_label(view, "agent_page.action.send").click());
    expect(send).toHaveBeenCalledWith({ text: "继续任务", attachments: [] });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("空对话切换到关闭思考时直接更新", async () => {
    model_thinking_state.thinking_level = "HIGH";
    model_thinking_state.available_thinking_levels = ["OFF", "HIGH"];
    const view = await render_page({ entries: [] });

    await select_agent_thinking_level(view, "app.model.thinking_level.off");

    expect(model_selection_commands.select_model).toHaveBeenCalledWith({
      target: "agent",
      model_id: "agent",
      thinking_level: "OFF",
    });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("已有对话切换到关闭思考时需确认", async () => {
    model_thinking_state.thinking_level = "HIGH";
    model_thinking_state.available_thinking_levels = ["OFF", "LOW", "HIGH"];
    const view = await render_page();

    await select_agent_thinking_level(view, "app.model.thinking_level.low");
    expect(model_selection_commands.select_model).toHaveBeenCalledWith({
      target: "agent",
      model_id: "agent",
      thinking_level: "LOW",
    });
    model_selection_commands.select_model.mockClear();

    await select_agent_thinking_level(view, "app.model.thinking_level.off");
    expect(model_selection_commands.select_model).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();

    await act(async () => get_portal_cancel_button().click());
    expect(model_selection_commands.select_model).not.toHaveBeenCalled();

    await select_agent_thinking_level(view, "app.model.thinking_level.off");
    await act(async () => get_portal_action_button().click());
    expect(model_selection_commands.select_model).toHaveBeenCalledWith({
      target: "agent",
      model_id: "agent",
      thinking_level: "OFF",
    });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("从 mention 菜单选择压缩指令后立即执行且不发送消息", async () => {
    const compactContext = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const view = await render_page({
      context: { tokens: 64_000, compactable: true, limits: null },
      compactContext,
      send,
    });
    const editor = EditorView.findFromDOM(view.querySelector<HTMLElement>(".cm-content")!);
    if (editor === null) throw new Error("缺少 Composer");
    await act(async () =>
      editor.dispatch({
        changes: { from: 0, insert: "@compact" },
        selection: EditorSelection.cursor(8),
      }),
    );
    const instruction = view.querySelector<HTMLButtonElement>(
      '[aria-labelledby="agent-mention-instructions-label"] [role="option"]',
    );
    if (instruction === null) throw new Error("缺少压缩指令");

    await act(async () => instruction.click());
    expect(editor.state.doc.toString()).toBe("");
    expect(compactContext).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["batch_translation", "model_test"] as const)(
    "%s 占用时暂停额外 Agent 执行入口",
    async (owner) => {
      const view = await render_page({
        context: { tokens: 1_000, compactable: false, limits: null },
      });
      const editor = EditorView.findFromDOM(view.querySelector<HTMLElement>(".cm-content")!);
      if (editor === null) throw new Error("缺少 Composer");
      await act(async () =>
        editor.dispatch({
          changes: { from: 0, insert: "@compact" },
          selection: EditorSelection.cursor(8),
        }),
      );
      const idle_instruction = view.querySelector<HTMLButtonElement>(
        '[aria-labelledby="agent-mention-instructions-label"] [role="option"]',
      );
      expect(idle_instruction?.disabled).toBe(true);

      runtime_state.current = { revision: 1, owner };
      await render_page({ context: { tokens: 1_000, compactable: false, limits: null } });
      const busy_instruction = view.querySelector<HTMLButtonElement>(
        '[aria-labelledby="agent-mention-instructions-label"] [role="option"]',
      );
      expect(busy_instruction?.disabled).toBe(true);
    },
  );

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
      false,
    );
    await act(async () => retry_button.click());
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("断线状态在输入工具栏展示并暂停发送", async () => {
    const view = await render_page({ transport: "disconnected" });
    const editor = get_editor(view);
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "待发送草稿" } }));

    expect(view.querySelector('.agent-composer__connection-status[role="status"]')).not.toBeNull();
    expect(get_button_by_label(view, "agent_page.action.send").disabled).toBe(true);
  });

  it("公开回合先结束但 Agent lease 尚未释放时保持结算禁用态", async () => {
    runtime_state.current = { revision: 1, owner: "agent" };
    const view = await render_page({ state: "idle" });
    const editor = EditorView.findFromDOM(view.querySelector(".cm-content")!)!;
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "继续任务" } }));
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");

    expect(submit?.disabled).toBe(true);
    runtime_state.current = { revision: 2, owner: null };
    await render_page({ state: "idle" });
    expect(submit?.disabled).toBe(false);
  });

  it("页面挂载时默认激活跟随最新并归底", async () => {
    const view = await render_page({ entries: [] });
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 0, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);

    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());
    expect(scroll.top).toBe(scroll_end(scroll));
    const button = get_follow_latest_button(view);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("按钮可取消跟随，再次点击才重新归底并激活", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 600, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);
    const button = get_follow_latest_button(view);

    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("false");

    scroll.top = 100;
    scroll.height = 1_200;
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());
    expect(scroll.top).toBe(100);

    await act(async () => button.click());
    expect(scroll.top).toBe(scroll_end(scroll));
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("Ctrl+E 在编辑器内切换跟随并公开可访问快捷键", async () => {
    const view = await render_page();
    const editor = view.querySelector<HTMLElement>(".cm-content");
    if (editor === null) throw new Error("缺少消息编辑器");
    const button = get_follow_latest_button(view);
    const event = new KeyboardEvent("keydown", {
      key: "e",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => editor.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+E");
  });

  it("离开底部自动取消跟随，按钮显式恢复并归底", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 600, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());

    scroll.top = 100;
    const reading_position = scroll.top;
    await act(async () => conversation.dispatchEvent(new Event("scroll")));
    const button = get_follow_latest_button(view);
    expect(button.getAttribute("aria-pressed")).toBe("false");

    scroll.height = 1_200;
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());
    expect(scroll.top).toBe(reading_position);

    await act(async () => button.click());
    expect(scroll.top).toBe(scroll_end(scroll));
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("满消息队列时页面禁用新增发送并显示容量提示", async () => {
    const view = await render_page({
      state: "running",
      inputQueue: {
        paused: false,
        canSendNow: false,
        items: Array.from({ length: AGENT_INPUT_QUEUE_LIMIT }, (_, index) => ({
          id: `queue-${index.toString()}`,
          text: `排队消息 ${index.toString()}`,
          attachments: [],
          status: "queued" as const,
          createdAt: index,
        })),
      },
    });
    const editor = get_editor(view);
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "新增消息" } }));
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");
    expect(submit?.disabled).toBe(true);
    expect(submit?.getAttribute("aria-label")).toContain("agent_page.queue.full");
  });

  it("会话内容替换保持用户的自由滚动模式", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 600, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());
    scroll.top = 100;
    const reading_position = scroll.top;

    await act(async () => conversation.dispatchEvent(new Event("scroll")));

    await render_page({ entries: [] });
    await render_page({ entries: [user_entry("user-next", "新会话", "success", 2, 3)] });
    expect(scroll.top).toBe(reading_position);
    expect(get_follow_latest_button(view).getAttribute("aria-pressed")).toBe("false");
  });

  it("自由滚动会取消已排队的布局跟随", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 600, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());

    scroll.height = 1_100;
    await act(async () => notify_resize_observers());
    scroll.top = 100;
    await act(async () => conversation.dispatchEvent(new Event("scroll")));
    const reading_position = scroll.top;
    await act(async () => next_animation_frame());
    expect(scroll.top).toBe(reading_position);
    expect(get_follow_latest_button(view).getAttribute("aria-pressed")).toBe("false");
  });

  it("布局变化只在最新模式归底", async () => {
    const view = await render_page();
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 600, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);

    scroll.height = 1_100;
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());
    expect(scroll.top).toBe(scroll_end(scroll));
    expect(get_follow_latest_button(view).getAttribute("aria-pressed")).toBe("true");
  });

  it("发送消息保持自由滚动模式", async () => {
    const send = vi.fn(async () => undefined);
    const view = await render_page({ send });
    const conversation = view.querySelector<HTMLElement>(".agent-page__conversation");
    if (conversation === null) throw new Error("缺少消息滚动容器");
    const scroll = { top: 600, height: 1_000, viewport: 400 };
    install_scroll_metrics(conversation, scroll);
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());
    scroll.top = 100;
    await act(async () => conversation.dispatchEvent(new Event("scroll")));
    const reading_position = scroll.top;

    const editor = get_editor(view);
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "继续任务" } }));
    await act(async () => get_button_by_label(view, "agent_page.action.send").click());
    expect(send).toHaveBeenCalledOnce();

    scroll.height = 1_100;
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());

    expect(scroll.top).toBe(reading_position);
    expect(get_follow_latest_button(view).getAttribute("aria-pressed")).toBe("false");
  });

  it("活动思考视口独立跟随并可由页面按钮重置", async () => {
    const view = await render_page({
      entries: [
        user_entry("user-thinking", "开始检查", "running", 0, null),
        assistant_parts_entry(
          "assistant-thinking",
          [{ kind: "thinking", text: "第一步\n第二步" }],
          "running",
          1,
        ),
      ],
    });
    const viewport = view.querySelector<HTMLElement>(".agent-thinking-entry__viewport");
    const body = view.querySelector<HTMLPreElement>(".agent-thinking-entry__viewport pre");
    if (viewport === null || body === null) throw new Error("缺少思考滚动容器");
    const thinking_scroll = { top: 240, height: 480, viewport: 240 };
    install_scroll_metrics(viewport, thinking_scroll);
    const button = get_follow_latest_button(view);
    await act(async () => notify_resize_observers(body));
    await act(async () => next_animation_frame());

    thinking_scroll.top = 80;
    await act(async () => viewport.dispatchEvent(new Event("scroll")));
    thinking_scroll.height = 640;
    await act(async () => notify_resize_observers(body));
    await act(async () => next_animation_frame());
    expect(thinking_scroll.top).toBe(80);

    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => button.click());
    expect(thinking_scroll.top).toBe(scroll_end(thinking_scroll));
    thinking_scroll.top = 80;
    thinking_scroll.height = 800;
    await act(async () => notify_resize_observers(body));
    await act(async () => next_animation_frame());
    expect(thinking_scroll.top).toBe(scroll_end(thinking_scroll));
  });

  it("历史思考视口不受页面按钮归底", async () => {
    const view = await render_page({
      entries: [
        user_entry("user-thinking", "开始检查", "success", 0, 2),
        assistant_parts_entry(
          "assistant-thinking",
          [{ kind: "thinking", text: "第一步\n第二步" }],
          "success",
          1,
        ),
      ],
    });
    const viewport = view.querySelector<HTMLElement>(".agent-thinking-entry__viewport");
    if (viewport === null) throw new Error("缺少思考滚动容器");
    const scroll = { top: 80, height: 480, viewport: 240 };
    install_scroll_metrics(viewport, scroll);
    const reading_position = scroll.top;
    scroll.height = 640;
    await act(async () => notify_resize_observers());
    await act(async () => next_animation_frame());
    expect(scroll.top).toBe(reading_position);
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

  it("选择期间收起操作区并在恢复后保留草稿、编辑实例和跟随状态", async () => {
    const pending_write_decision = {
      kind: "write_approval" as const,
      id: "apply-1",
      summary: {
        pages: 0,
        items: 1,
        glossary: 0,
        textPreserve: 0,
        preReplacement: 0,
        postReplacement: 0,
        prompts: 0,
      },
    };
    const input: AgentInputSession = {
      ...build_state().input,
      draft: new AgentInputDraft({
        text: "",
        attachments: [
          { kind: "response_annotation", selectedText: "需要复核的段落", comment: "检查人称" },
        ],
      }),
    };
    const send = vi.fn(async () => undefined);
    const view = await render_page({ input, send });
    const host = view.querySelector<HTMLElement>(".cm-content")!;
    const editor = EditorView.findFromDOM(host)!;
    await act(async () => {
      editor.dispatch({ changes: { from: 0, insert: "保留这份草稿" }, selection: { anchor: 3 } });
      host.focus();
    });
    await render_page({ input, send, pendingDecision: pending_write_decision });
    const body = view.querySelector(".agent-page__composer-slot")!;
    expect(body.hasAttribute("inert")).toBe(true);
    const follow_button = get_button_by_label(view, "agent_page.action.follow_latest");
    expect(follow_button.closest("[inert]")).toBe(view.querySelector(".agent-page__status-zone"));
    expect(follow_button.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(view.querySelector(".agent-decision__prompt"));
    await act(async () => {
      view
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(send).not.toHaveBeenCalled();
    await render_page({ input, send, pendingDecision: null });
    expect(body.hasAttribute("inert")).toBe(false);
    expect(EditorView.findFromDOM(host)).toBe(editor);
    expect(editor.state.doc.toString()).toBe("保留这份草稿");
    expect(editor.state.selection.main.anchor).toBe(3);
    expect(view.textContent).toContain("需要复核的段落");
    expect(document.activeElement).toBe(host);
    expect(view.querySelector(".agent-decision")).toBeNull();
    expect(follow_button.closest("[inert]")).toBeNull();
    expect(follow_button.getAttribute("aria-pressed")).toBe("true");
  });

  it("压缩失败后保留普通 round 操作与新消息发送", async () => {
    const send = vi.fn(async () => undefined);
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
      send,
      continue: continue_session,
    });
    const message_continue = view.querySelector<HTMLButtonElement>(".agent-continue-entry");
    expect(message_continue?.disabled).toBe(false);
    expect(
      view.querySelector<HTMLButtonElement>(".agent-message-actions button:last-of-type")?.disabled,
    ).toBe(false);

    const editor = get_editor(view);
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "新任务" } }));
    await act(async () => get_button_by_label(view, "agent_page.action.send").click());
    expect(send).toHaveBeenCalledWith({ text: "新任务", attachments: [] });

    await act(async () => message_continue?.click());

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

  it("历史消息原位编辑直接保存输入与输出", async () => {
    const reviseLatestRound = vi.fn(async () => undefined);
    const entries = [
      user_entry("user-write", "原输入", "success", 0, 3),
      workspace_apply_entry("apply-1"),
      assistant_entry("assistant-write", "原输出", "success", 2),
    ];
    const ordinary_input = build_state().input;
    ordinary_input.draft.write({ text: "普通草稿", attachments: [] });
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
    expect(view.querySelector(".agent-composer--inline .agent-composer__file-trigger")).toBeNull();
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
      expect(push_toast).toHaveBeenCalledWith("error", "agent_page.error.edit"),
    );

    expect(get_editor(view).state.doc.toString()).toBe("新输入");
    expect(push_toast).toHaveBeenCalledTimes(1);
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

/** 每次渲染创建独立会话快照，场景仅覆盖所需字段。 */
function build_state(overrides: Partial<AgentPageState> = {}): AgentPageState {
  return {
    state: "idle",
    approvalMode: "manual",
    pendingDecision: null,
    entries: [
      user_entry("user-1", "开始", "success", 0, 1),
      assistant_entry("assistant-1", "**变更方案**", "success", 1),
    ],
    skills: [],
    inputQueue: { paused: false, canSendNow: false, items: [] },
    todos: [],
    context: { tokens: null, compactable: false, limits: null },
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    transport: "ready",
    command: null,
    input: {
      revision: 0,
      draft: new AgentInputDraft(),
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
    compactContext: vi.fn(async () => undefined),
    stop: vi.fn(),
    reset: vi.fn(async () => undefined),
    setApprovalMode: vi.fn(async () => undefined),
    resolveQuestion: vi.fn(async () => undefined),
    resolveWriteApproval: vi.fn(async () => undefined),
    setQuestionFocused: vi.fn(),
    reconnect: vi.fn(),
    ...overrides,
  };
}

/** 从实际页面区域分发文件输入，观察最终草稿和保存行为。 */
async function drop_image(target: Element, name: string): Promise<void> {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files: [new File([], name, { type: "image/png" })] },
  });
  await act(async () => target.dispatchEvent(event));
}

/** 构造带回合归属与完成时间的用户消息。 */
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
    averageTokensPerSecond: null,
    text,
    attachments: [],
    status,
    createdAt,
    endedAt,
  };
}

/** 将普通助手正文装配为公开 parts 消息。 */
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
    output: ["{}"],
    createdAt: 1,
  };
}

/** 按公开结构构造可含多种内容的助手消息。 */
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

/** 按可访问名称定位操作入口。 */
function get_button_by_label(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`缺少按钮：${label}`);
  return button;
}

/** 定位页面共享的跟随切换入口。 */
function get_follow_latest_button(container: HTMLElement): HTMLButtonElement {
  return get_button_by_label(container, "agent_page.action.follow_latest");
}

/** 获取实际 CodeMirror 实例以驱动编辑行为。 */
function get_editor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) throw new Error("缺少 CodeMirror 编辑器");
  return editor;
}

/** 通过合并后的模型菜单选择思考档位。 */
async function select_agent_thinking_level(container: HTMLElement, label: string): Promise<void> {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="app.model.selection.label"]',
  );
  if (trigger === null) throw new Error("缺少模型入口");
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger.click();
  });
  const category = [
    ...document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
  ].find(
    (item) =>
      item.textContent?.includes("app.model.type.openai") && !item.hasAttribute("data-disabled"),
  )!;
  await act(async () => category.click());
  const model = [
    ...document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
  ].find((item) => item.title === "Agent Model")!;
  await act(async () =>
    model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
  );
  const option = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (option === undefined) throw new Error(`缺少思考档位：${label}`);
  await act(async () => option.click());
}

/** 定位当前确认框的主操作。 */
function get_portal_action_button(): HTMLButtonElement {
  const dialog = document.body.querySelector('[data-slot="alert-dialog-content"]');
  const button = dialog?.querySelector<HTMLButtonElement>(
    '[data-slot="alert-dialog-primary-action"]',
  );
  if (button === null || button === undefined) throw new Error("缺少弹窗确认按钮");
  return button;
}

/** 定位当前确认框的取消操作。 */
function get_portal_cancel_button(): HTMLButtonElement {
  const dialog = document.body.querySelector('[data-slot="alert-dialog-content"]');
  const button = dialog?.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]');
  if (button === null || button === undefined) throw new Error("缺少弹窗取消按钮");
  return button;
}
