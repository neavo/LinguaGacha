import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentAssistantMessagePart, AgentEntryStatus } from "@shared/agent";
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
    completed_entry_ids: [] as string[],
    matched_count_by_entry_id: {} as Record<string, number>,
  },
}));
const push_toast = vi.hoisted(() => vi.fn());
/** 模拟模型页更新后的共享选择快照，验证同一会话无需重建即可刷新容量。 */
const model_agent_limits = vi.hoisted(() => ({
  context_window: 288_000,
  max_output_tokens: 32_000,
}));

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
      if (key === "agent_page.action.retry") return "重试";
      if (key === "agent_page.confirm.new_task") return "是否确认开始新的对话任务 …?";
      if (key === "agent_page.empty.suggestions.capabilities") return "介绍你的能力";
      if (key === "agent_page.empty.suggestions.glossary_review") return "请帮我审校术语";
      if (key === "agent_page.empty.suggestions.translation_review") return "请帮我审校译文";
      if (key === "agent_page.mention.groups.skills") return "技能";
      if (key === "agent_page.mention.groups.terms") return "术语";
      if (key === "agent_page.mention.no_matches") return "没有匹配的项目 …";
      if (key === "agent_page.mention.term_hits") return `${params?.["count"]} 次`;
      if (key === "agent_page.error.terms_load") return "术语加载失败";
      if (key === "agent_page.error.send") return "发送失败，草稿已保留。";
      if (key === "agent_page.error.stop") return "停止失败，请重试。";
      if (key === "agent_page.error.reset") return "新任务创建失败，请重试。";
      if (key === "agent_page.error.connection") return "连接中断，正在等待重连。";
      if (key === "agent_page.status.error") return "失败";
      if (key === "app.error.model.provider_failed.message") return "模型服务请求失败。";
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
    desktop_state.current = {
      project_snapshot: { loaded: true, path: "E:/demo/demo.lg" },
      project_session_status: "ready",
    };
    quality_query_state.entries = [];
    quality_query_state.last_args = null;
    quality_statistics_state.current = {
      completed_entry_ids: [],
      matched_count_by_entry_id: {},
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

  it("空会话按顺序显示三个起始任务，并把能力写成字面量草稿", async () => {
    const send = vi.fn(async () => undefined);
    const view = await render_page({ entries: [], send });
    const suggestions = [...view.querySelectorAll<HTMLButtonElement>(".agent-page__suggestion")];
    const editor = view.querySelector<HTMLElement>(".cm-content");
    const submit = get_button_by_label(view, "发送");

    expect(suggestions.map((button) => button.textContent)).toEqual([
      "介绍你的能力",
      "请帮我审校术语 @skill(glossary-review)",
      "请帮我审校译文 @skill(translation-review)",
    ]);
    expect(
      [
        ...view.querySelectorAll<HTMLElement>(
          ".agent-page__suggestion .agent-mention-token > span",
        ),
      ].map((token) => token.textContent),
    ).toEqual(["@skill(glossary-review)", "@skill(translation-review)"]);
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
    expect(send).toHaveBeenLastCalledWith("介绍你的能力");

    await act(async () => suggestions[2]?.click());
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith("请帮我审校译文 @skill(translation-review)");

    await render_page();
    expect(view.querySelectorAll(".agent-page__suggestion")).toHaveLength(0);
  });

  it("featured skill 各自按真实加载状态显示，非 featured skill 不进入空态", async () => {
    const glossary = build_state().skills.find((skill) => skill.name === "glossary-review");
    const translation = build_state().skills.find((skill) => skill.name === "translation-review");
    const corpus = build_state().skills.find((skill) => skill.name === "corpus-search");
    if (glossary === undefined || translation === undefined || corpus === undefined) {
      throw new Error("缺少 skill fixture");
    }
    const view = await render_page({ entries: [], skills: [translation, corpus] });
    expect(
      [...view.querySelectorAll<HTMLButtonElement>(".agent-page__suggestion")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["介绍你的能力", "请帮我审校译文 @skill(translation-review)"]);

    await render_page({ entries: [], skills: [glossary, corpus] });
    expect(
      [...view.querySelectorAll<HTMLButtonElement>(".agent-page__suggestion")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["介绍你的能力", "请帮我审校术语 @skill(glossary-review)"]);

    await render_page({ entries: [], skills: [corpus] });
    expect(
      [...view.querySelectorAll<HTMLButtonElement>(".agent-page__suggestion")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["介绍你的能力"]);
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
      completed_entry_ids: ["alice"],
      matched_count_by_entry_id: { alice: 7 },
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
    ).toContain("Alice爱丽丝 · 主角 · 7 次");
    expect(quality_query_state.last_args).toMatchObject({
      rule_type: "glossary",
      project_path: "E:/demo/demo.lg",
      session_ready: true,
    });

    const on_load_error = quality_query_state.last_args?.["on_load_error"];
    if (typeof on_load_error !== "function") throw new Error("缺少术语错误出口");
    await act(async () => on_load_error(new Error("load failed")));
    expect(push_toast).toHaveBeenCalledWith("error", "术语加载失败");

    desktop_state.current = {
      project_snapshot: { loaded: false, path: "" },
      project_session_status: "ready",
    };
    await render_page({ entries: [], send });
    expect(quality_query_state.last_args).toMatchObject({ project_path: "" });
    expect(view.textContent).toContain("介绍你的能力");
    expect(view.querySelector('[aria-labelledby="agent-mention-terms-label"]')).toBeNull();
  });

  it("底栏用会话 token 和当前模型容量即时重算", async () => {
    const view = await render_page({
      contextTokens: 31_488,
    });
    expect(view.querySelector(".agent-composer__context-usage")?.textContent).toBe("10.9%");

    model_agent_limits.context_window = 64_000;
    model_agent_limits.max_output_tokens = 16_000;
    await render_page({ contextTokens: 31_488 });
    expect(view.querySelector(".agent-composer__context-usage")?.textContent).toBe("49.2%");
  });

  it("恢复失败时显示单一重试入口并重新连接", async () => {
    const reconnect = vi.fn();
    const view = await render_page({ transport: "restore_failed", reconnect });
    const alert = view.querySelector<HTMLElement>('[role="alert"]');
    const retry_button = [...view.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "重试",
    );
    if (retry_button === undefined) throw new Error("缺少恢复重试按钮");

    expect(alert?.textContent).toContain("agent_page.error.restore");
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__model-trigger")?.disabled).toBe(
      true,
    );
    await act(async () => retry_button.click());
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("连接中断时在对话区持续提示且不污染操作栏", async () => {
    const view = await render_page({ transport: "disconnected" });
    expect(view.querySelector('[role="status"]')?.textContent).toBe("连接中断，正在等待重连。");
    expect(view.querySelector(".agent-composer__error")).toBeNull();
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

  it("停止命令失败时保留运行态并显示错误 Toast", async () => {
    const stop = vi.fn(() => Promise.reject(new Error("offline")));
    const view = await render_page({ state: "running", stop });
    await act(async () => {
      get_button_by_label(view, "agent_page.action.stop").click();
      await vi.waitFor(() =>
        expect(push_toast).toHaveBeenCalledWith("error", "停止失败，请重试。"),
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
      get_button_by_label(view, "发送").click();
      await vi.waitFor(() => expect(push_toast).toHaveBeenCalledOnce());
    });

    expect(push_toast).toHaveBeenCalledWith("error", "发送失败，草稿已保留。");
    expect(view.querySelector(".agent-composer__error")).toBeNull();
  });

  it("失败轮次的重试把原消息恢复到输入框但不自动发送", async () => {
    const send = vi.fn(async () => undefined);
    const view = await render_page({
      entries: [user_entry("user-error", "重新检查术语", "error", 1, 2)],
      send,
    });
    const retry = [...view.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "重试",
    );
    if (retry === undefined) throw new Error("缺少轮次重试按钮");
    await act(async () => retry.click());

    expect(get_editor(view).state.doc.toString()).toBe("重新检查术语");
    expect(send).not.toHaveBeenCalled();
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
    await act(async () => get_portal_button("app.action.confirm").click());
    expect(reset).toHaveBeenCalledOnce();
    expect(push_toast).toHaveBeenCalledWith("error", "新任务创建失败，请重试。");
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
  });
});

function build_state(overrides: Partial<AgentPageState> = {}): AgentPageState {
  const skills = [
    {
      name: "glossary-review",
      displayDescriptions: {
        "zh-CN": "审校术语",
        "en-US": "Review glossary",
        "de-DE": "Glossar prüfen",
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
    entries: [assistant_entry("assistant-1", "**变更方案**", "success", 1)],
    skills,
    contextTokens: overrides.contextTokens ?? null,
    transport: "ready",
    command: null,
    input: {
      revision: 0,
      read_draft: () => "",
      write_draft: vi.fn(),
      read_history: () => [],
    },
    send: vi.fn(async () => undefined),
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
  return { kind: "user_message" as const, id, text, status, createdAt, endedAt };
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

function get_button_by_label(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`缺少按钮：${label}`);
  return button;
}

function get_editor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) throw new Error("缺少 CodeMirror 编辑器");
  return editor;
}

function get_portal_button(label: string): HTMLButtonElement {
  const dialog = document.body.querySelector('[data-slot="alert-dialog-content"]');
  const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`缺少弹窗按钮：${label}`);
  return button;
}
