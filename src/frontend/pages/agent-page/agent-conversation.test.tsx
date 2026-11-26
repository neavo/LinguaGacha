import {
  ProjectLifecycleContext,
  type ProjectLifecycle,
} from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
const project_state = vi.hoisted(() => ({
  settings: {
    source_language: "JA",
    target_language: "ZH",
    mtool_optimizer_enable: true,
    skip_duplicate_source_text_enable: true,
  },
}));
import { AgentTimelineStore } from "@frontend/app/session/agent/agent-timeline-store";
vi.mock("./use-agent-mention-files", () => ({
  useAgentMentionFiles: () => ({ files: [], status: "idle" }),
}));
import type { AgentInputRequest } from "@frontend/app/navigation/types";
import { AgentInputDraft } from "@frontend/app/session/agent/agent-input-draft";
import { api_upload } from "@frontend/app/desktop/desktop-api";
import { uploaded_file } from "../../../test/agent-upload-fixture";
vi.mock("@frontend/app/session/batch-task/batch-task-session-context", () => ({
  useBatchTaskSession: () => ({ metrics: { kind: null } }),
}));
import { act, StrictMode, useState } from "react";
import { DEFAULT_PROJECT_LANGUAGE_SETTINGS } from "@domain/project-settings";
import {
  read_project_language_preference,
  PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY,
} from "@frontend/features/project-lifecycle/project-language-preference";
import { ProjectStore } from "@frontend/app/state/project-store-registry";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { build_project_translation_stats } from "@shared/project-translation-stats";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { ModelThinkingLevel } from "@domain/model";
import type { AgentApprovalMode } from "@domain/setting";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import {
  AGENT_INPUT_QUEUE_LIMIT,
  type AgentAssistantMessageParts,
  type AgentEntryStatus,
  type AgentEntry,
} from "@shared/agent";
import type {
  AgentControlsSlice,
  AgentInputState,
  AgentQueueSlice,
  AgentChatActions,
  AgentSkillsSlice,
} from "@frontend/app/session/agent/agent-chat-store";

type AgentPageState = { entries: AgentEntry[] } & AgentControlsSlice &
  AgentQueueSlice &
  AgentSkillsSlice &
  AgentChatActions & { input: AgentInputState };

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
const settings_state = vi.hoisted(() => ({
  snapshot: { agent_approval_mode: "manual" as AgentApprovalMode },
  /** 保存响应成为后续渲染读取的设置快照。 */
  apply_snapshot: (payload: SettingsSnapshotPayload): void => {
    settings_state.snapshot = { agent_approval_mode: payload.settings!.agent_approval_mode! };
  },
  save: vi.fn<(path: string, body: Record<string, unknown>) => Promise<SettingsSnapshotPayload>>(),
}));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: settings_state.save,
  api_blob: async () => new Blob([], { type: "image/png" }),
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

/** 尺寸变化由测试定向通知实际订阅的元素。 */
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

vi.mock("@frontend/app/session/agent/agent-chat-context", async (original) => ({
  ...(await original<typeof import("@frontend/app/session/agent/agent-chat-context")>()),
  useAgentTokenSpeed: () => null,
  useAgentRunOutput: () => null,
  useAgentTimeline: () => read_test_timeline().read(),
  useAgentEntry: (id: string | null) => read_test_timeline().entry(id),
  useAgentRound: (id: string) => ({
    entryIds: read_test_timeline().round(id),
    latestAssistantId: read_test_timeline().latest_assistant(id),
  }),
  useAgentControls: (): AgentControlsSlice => page_state.current,
  useAgentQueue: () => ({ inputQueue: page_state.current.inputQueue }),
  useAgentSkills: () => ({ skills: page_state.current.skills }),
  useAgentInput: () => page_state.current.input,
  useAgentDecisionCountdown: () => null,
  useAgentChatActions: () => page_state.current,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => runtime_state.current,
  useDesktopState: () => ({
    project_snapshot: project_state,
    settings_snapshot: { ...settings_state.snapshot, recent_projects: [] },
    apply_settings_snapshot: settings_state.apply_snapshot,
  }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_toast,
  push_toast,
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

import { AgentConversation, EmptyAgentConversation } from "./agent-conversation";

const lifecycle: ProjectLifecycle = {
  busy: false,
  request_create: vi.fn(),
  create_for_agent: vi.fn(async () => null),
  request_open: vi.fn(),
  open_recent_project: vi.fn(),
  remove_recent_project: vi.fn(),
  request_close: vi.fn(),
};

function EmptyConversation() {
  const [input_state] = useState(() => ({
    revision: 0,
    draft: new AgentInputDraft(null),
    read_history: () => [],
    replace_history: () => {},
  }));
  const [known_paths] = useState(() => new Set<string>());
  const [languages, set_languages] = useState(() => DEFAULT_PROJECT_LANGUAGE_SETTINGS);
  return (
    <EmptyAgentConversation
      input_state={input_state}
      known_paths={known_paths}
      languages={languages}
      on_languages_change={set_languages}
    />
  );
}

describe("AgentConversation", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.mocked(lifecycle.create_for_agent).mockReset().mockResolvedValue(null);
    vi.mocked(lifecycle.request_open).mockClear();
    vi.stubGlobal(
      "desktopApp",
      create_desktop_bridge_api_mock({
        methods: { getPathForFile: (file: File) => `E:/資料/${file.name}` },
      }),
    );
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    resize_observers.clear();
    runtime_state.current = { revision: 0, owner: null };
    push_toast.mockReset();
    settings_state.snapshot = { agent_approval_mode: "manual" };
    settings_state.save.mockReset();
    settings_state.save.mockImplementation(async (path) =>
      path === "/api/skills/snapshot" ? ({ skills: [] } as never) : {},
    );
    navigation.agent_input_request = null;
    navigation.clear_agent_input_request.mockReset();
    model_thinking_state.thinking_level = "OFF";
    model_thinking_state.available_thinking_levels = [];
    model_selection_commands.select_model.mockClear();
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    resize_observers.clear();
    vi.unstubAllGlobals();
    localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  });

  /** 只替换页面拥有者的公开快照，并复用 root 验证真实状态迁移。 */
  async function render_page(
    overrides: Partial<AgentPageState> = {},
    active = true,
    Conversation = AgentConversation,
  ): Promise<HTMLDivElement> {
    // 真实 Store 在草稿 `revision` 变化前保留输入端口。普通运行态更新继续消费同一份草稿。
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
            <ProjectLifecycleContext value={lifecycle}>
              <Conversation active={active} />
            </ProjectLifecycleContext>
          </TooltipProvider>
        </StrictMode>,
      ),
    );
    return container;
  }

  it("无工程时拖入路径写入正文，已删除的路径失效，单个工程文件仍打开预览", async () => {
    settings_state.save.mockImplementation(async (path) => {
      if (path === "/api/skills/snapshot") return { skills: [] } as never;
      if (path === "/api/session/project/preview") {
        return {
          preview: {
            file_paths: ["a.txt"],
            created_at: "2026-11-24T17:23:15",
            updated_at: "2026-11-24T17:53:28",
            translation_stats: build_project_translation_stats([]),
          },
        } as never;
      }
      return {};
    });
    const view = await render_page({}, true, EmptyConversation);
    const editor = view.querySelector(".cm-content")!;
    const page = view.querySelector(".agent-page")!;
    function drop(target: Element, files: File[]): void {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
      target.dispatchEvent(event);
    }
    await act(async () => drop(editor, [new File([], "素材"), new File([], "素材备份")]));
    expect(lifecycle.create_for_agent).not.toHaveBeenCalled();
    const input = get_editor(view);
    const draft = input.state.doc.toString();
    expect(draft).toContain("\nE:/資料/素材\nE:/資料/素材备份\n");
    await act(async () => drop(page, [new File([], "追加图片.png")]));
    expect(input.state.doc.toString()).toBe(`${draft}\nE:/資料/追加图片.png`);
    expect(view.querySelector(".agent-attachment")).toBeNull();
    await act(async () =>
      input.dispatch({
        changes: {
          from: 0,
          to: input.state.doc.length,
          insert: "E:/資料/素材备份\nE:/未登记/日志.txt",
        },
      }),
    );
    await act(async () => get_button_by_label(view, "agent_page.action.send").click());
    expect(lifecycle.create_for_agent).toHaveBeenCalledExactlyOnceWith({
      languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS,
      anchor_paths: ["E:/資料/素材备份"],
    });
    expect(input.state.doc.toString()).toBe("E:/資料/素材备份\nE:/未登记/日志.txt");
    await act(async () => drop(page, [new File([], "已有工程.LG")]));
    expect(lifecycle.request_open).not.toHaveBeenCalled();

    const dialog = document.querySelector('[data-slot="alert-dialog-content"]')!;
    expect(dialog.textContent).toContain("E:/資料/已有工程.LG");
    const open_button = dialog.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-primary-action"]',
    )!;
    expect(open_button.textContent).toContain("app.action.open");
    await act(async () => open_button.click());
    expect(lifecycle.request_open).toHaveBeenCalledExactlyOnceWith("E:/資料/已有工程.LG");
  });

  it("无工程时保留底栏工具和技能补全，四条宿主指令中仅压缩禁用", async () => {
    settings_state.save.mockImplementation(async (path) => {
      if (path === "/api/skills/snapshot") {
        return {
          skills: [
            {
              name: "translation",
              source: "builtin",
              displayDescriptions: { "zh-CN": "翻译技能" },
              enabled: true,
            },
            {
              name: "disabled-skill",
              source: "user",
              displayDescriptions: { "zh-CN": "已停用" },
              enabled: false,
            },
          ],
        } as never;
      }
      return { settings: { agent_approval_mode: "auto" } };
    });
    const view = await render_page({}, true, EmptyConversation);
    expect(view.querySelector(".agent-composer__model-trigger")).not.toBeNull();
    expect(view.querySelector(".agent-composer__approval-trigger")).not.toBeNull();
    expect(view.querySelector(".agent-composer__help")).not.toBeNull();

    await act(async () =>
      view.querySelector<HTMLButtonElement>(".agent-composer__instructions-trigger")!.click(),
    );
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const skills = options.filter((item) => item.dataset.kind === "skill");
    const instructions = options.filter((item) => item.dataset.kind === "instruction");
    expect(skills.map((item) => item.querySelector("strong")?.textContent)).toEqual([
      "translation",
    ]);
    expect(instructions.map((item) => item.querySelector("strong")?.textContent)).toEqual([
      "agent_page.mention.instructions.compact_context.title",
      "agent_page.mention.instructions.update_file.title",
      "game_font_page.title",
      "app.translation_export.action",
    ]);
    expect(instructions.map((item) => item.disabled)).toEqual([true, false, false, false]);
  });

  it("无工程时选择与粘贴的附件先暂存，只在建项成功后交接", async () => {
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = vi.fn(() => "blob:draft-preview");
        static override revokeObjectURL = revoke;
      },
    );
    const photo = new File(["image"], "screenshot.png");
    const notes = new File(["notes"], "notes.txt");
    vi.stubGlobal(
      "desktopApp",
      create_desktop_bridge_api_mock({
        methods: { getPathForFile: (file) => (file === photo ? "" : "E:/資料/notes.txt") },
      }),
    );
    const view = await render_page({}, true, EmptyConversation);
    const picker = view.querySelector<HTMLInputElement>('input[type="file"]')!;
    const open_picker = vi.spyOn(picker, "click");
    await act(async () =>
      view.querySelector<HTMLButtonElement>(".agent-composer__file-trigger")!.click(),
    );
    expect(open_picker).toHaveBeenCalledOnce();
    open_picker.mockRestore();
    Object.defineProperty(picker, "files", { value: [notes] });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [photo], getData: () => "" } });
    await act(async () => view.querySelector(".cm-content")!.dispatchEvent(paste));
    expect(view.querySelector(".agent-attachment img")?.getAttribute("src")).toBe(
      "blob:draft-preview",
    );

    const language = get_button_by_label(view, "project.language.title");
    await act(async () => language.click());
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="combobox"][aria-label="app.language_role.source"]',
        )!
        .click(),
    );
    const english = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent === "app.language.EN",
    )!;
    await act(async () => english.click());
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-keyshortcuts="Enter"]')!
        .click(),
    );
    expect(read_project_language_preference().source_language).toBe("EN");

    const send = get_button_by_label(view, "agent_page.action.send");
    vi.mocked(lifecycle.create_for_agent).mockResolvedValueOnce(null);
    await act(async () => send.click());
    expect(view.querySelectorAll(".agent-attachment")).toHaveLength(2);
    expect(lifecycle.create_for_agent).toHaveBeenLastCalledWith({
      languages: { source_language: "EN", target_language: "ZH" },
      anchor_paths: ["E:/資料/notes.txt"],
    });

    const project = new ProjectStore({
      projectId: "created",
      name: "notes.lg",
      path: "E:/資料/notes.lg",
      loaded: true,
      file_count: 0,
      quality_rule_counts: {
        glossary: 0,
        text_preserve: 0,
        pre_replacement: 0,
        post_replacement: 0,
      },
      settings: null,
    });
    const handoff = vi.spyOn(project.agentChat, "send_initial_draft").mockResolvedValue();
    vi.mocked(lifecycle.create_for_agent).mockResolvedValueOnce(project);
    await act(async () => send.click());
    expect(handoff).toHaveBeenCalledExactlyOnceWith({ text: "", files: [notes, photo] });
    expect(view.querySelector(".agent-attachment")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:draft-preview");
  });

  it("无工程首条消息取消思考确认时保留正文且不建项", async () => {
    model_thinking_state.available_thinking_levels = ["OFF"];
    const view = await render_page({}, true, EmptyConversation);
    const editor = get_editor(view);
    await act(async () => editor.dispatch({ changes: { from: 0, insert: "执行任务" } }));
    await act(async () => get_button_by_label(view, "agent_page.action.send").click());
    expect(lifecycle.create_for_agent).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot="alert-dialog-content"]')?.textContent).toContain(
      "agent_page.confirm.thinking_off",
    );
    await act(async () => get_portal_cancel_button().click());
    expect(lifecycle.create_for_agent).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe("执行任务");
  });

  it.each(["success", "failure"] as const)(
    "运行中保存审批偏好，%s 后展示已确认设置",
    async (outcome) => {
      let resolve!: (value: SettingsSnapshotPayload) => void;
      let reject!: (error: Error) => void;
      settings_state.save.mockReturnValueOnce(
        new Promise((accept, fail) => {
          resolve = accept;
          reject = fail;
        }),
      );
      runtime_state.current = { revision: 1, owner: "agent" };
      const view = await render_page({ state: "running" });
      const trigger = view.querySelector<HTMLButtonElement>(".agent-composer__approval-trigger")!;
      await act(async () => trigger.click());
      const auto = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent?.includes("agent_page.approval.auto"),
      )!;
      await act(async () => auto.click());
      expect(settings_state.save).toHaveBeenCalledWith("/api/settings/update", {
        agent_approval_mode: "auto",
      });
      expect(trigger.disabled).toBe(true);
      expect(trigger.dataset.approvalMode).toBe("manual");
      await act(async () => {
        if (outcome === "success") resolve({ settings: { agent_approval_mode: "auto" } });
        else reject(new Error("保存失败"));
      });
      expect(trigger.disabled).toBe(false);
      expect(trigger.dataset.approvalMode).toBe(outcome === "success" ? "auto" : "manual");
      expect(push_toast).toHaveBeenCalledTimes(outcome === "failure" ? 1 : 0);
    },
  );

  it("隐藏再显示保留 CodeMirror 实例、正文和选区，隐藏期间暂停跟随快捷键", async () => {
    const view = await render_page();
    const editor = EditorView.findFromDOM(view.querySelector(".cm-editor")!)!;
    await act(async () =>
      editor.dispatch({
        changes: { from: 0, insert: "待发送草稿" },
        selection: EditorSelection.range(1, 3),
      }),
    );
    await render_page({}, false);
    const event = new KeyboardEvent("keydown", {
      key: "e",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await render_page({}, true);
    expect(EditorView.findFromDOM(view.querySelector(".cm-editor")!)).toBe(editor);
    expect(editor.state.doc.toString()).toBe("待发送草稿");
    expect(editor.state.selection.main.from).toBe(1);
    expect(editor.state.selection.main.to).toBe(3);
  });

  it("导航请求转交选区且只消费一次", async () => {
    const input = build_state().input;
    const attachments = [uploaded_file("old")];
    input.draft.write({ text: "原草稿", attachments });
    const text = "导入：[路径]";
    navigation.agent_input_request = {
      text,
      selection: { from: 3, to: text.length },
    };
    const send = vi.fn();
    const view = await render_page({ input, send });
    const editor = EditorView.findFromDOM(view.querySelector(".cm-editor")!)!;
    expect(
      editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to),
    ).toBe("[路径]");
    const expected_text = `原草稿\n${text}`;
    expect(input.draft.read()).toEqual({ text: expected_text, attachments });
    expect(send).not.toHaveBeenCalled();
    await render_page({ input, send });
    expect(input.draft.read()).toEqual({ text: expected_text, attachments });
    expect(navigation.clear_agent_input_request).toHaveBeenCalledOnce();
  });

  it("会话恢复完成后才消费导航请求", async () => {
    const input = build_state().input;
    navigation.agent_input_request = { text: "安装请求" };
    await render_page({ input, transport: "restoring" });
    expect(input.draft.read().text).toBe("");
    expect(navigation.clear_agent_input_request).not.toHaveBeenCalled();
    await render_page({ input, transport: "ready" });
    expect(input.draft.read().text).toBe("安装请求");
  });

  it("输入锁释放后才消费导航请求", async () => {
    const input = build_state().input;
    input.draft.write({ text: "原草稿", attachments: [] });
    navigation.agent_input_request = { text: "安装请求" };
    await render_page({ input, command: "send" });
    expect(input.draft.read().text).toBe("原草稿");
    expect(navigation.clear_agent_input_request).not.toHaveBeenCalled();
    await render_page({ input, command: null });
    expect(input.draft.read().text).toBe("原草稿\n安装请求");
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
    const reviseRound = vi.fn(async () => undefined);
    const view = await render_page({ input, reviseRound });
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
    expect(reviseRound).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        attachments: [uploaded_file("webp-inline.png")],
      }),
    );
  });

  it("空会话建议写入草稿而不直接发送", async () => {
    const send = vi.fn(async () => undefined);
    const view = await render_page({ entries: [], skills: [], send });
    const suggestion = view.querySelector<HTMLButtonElement>(".agent-page__suggestion");
    const editor = view.querySelector<HTMLElement>(".cm-content");
    const submit = get_button_by_label(view, "agent_page.action.send");
    const suggestion_text = suggestion?.textContent?.trim();
    if (suggestion === null || suggestion_text === undefined) throw new Error("缺少任务建议");
    expect(view.querySelector(".agent-composer__reset")).toBeNull();

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

  it("当前会话可压缩且空闲时，菜单指令直接执行压缩", async () => {
    const compactContext = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const options: Partial<AgentPageState> = {
      context: { tokens: 64_000, compactable: true, limits: null },
      compactContext,
      send,
    };
    const view = await render_page({ ...options, state: "running" });
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

    expect(instruction.disabled).toBe(true);
    await render_page({ ...options, context: { tokens: 0, compactable: false, limits: null } });
    expect(instruction.disabled).toBe(true);

    await render_page(options);
    await act(async () => instruction.click());
    expect(editor.state.doc.toString()).toBe("");
    expect(compactContext).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it("无工程时选择导出翻译成果指令，保留输入并追加导出草稿", async () => {
    const view = await render_page({}, true, EmptyConversation);
    const editor = EditorView.findFromDOM(view.querySelector<HTMLElement>(".cm-content")!);
    if (editor === null) throw new Error("缺少 Composer");
    await act(async () =>
      editor.dispatch({
        changes: { from: 0, insert: "已有输入\n@export" },
        selection: EditorSelection.cursor("已有输入\n@export".length),
      }),
    );
    const instruction = view.querySelector<HTMLButtonElement>(
      '[aria-labelledby="agent-mention-instructions-label"] [role="option"]',
    );
    if (instruction === null) throw new Error("缺少导出翻译成果指令");

    await act(async () => instruction.click());
    expect(editor.state.doc.toString()).toContain("已有输入");
    expect(editor.state.doc.toString()).toContain(
      'app.translation_export.agent_request @skill("project-operation")',
    );
  });

  it.each([
    [
      "@update",
      '@skill("project-operation")\nagent_page.mention.instructions.update_file.request\napp.agent_input.path_placeholder',
    ],
    [
      "@change_game_font",
      "agent_page.mention.instructions.change_game_font.font_file\napp.agent_input.path_placeholder\n\nagent_page.mention.instructions.change_game_font.game_path\napp.agent_input.path_placeholder\n\nagent_page.mention.instructions.change_game_font.request",
    ],
  ])("从 mention 菜单选择 %s 指令后预置草稿并选中首个路径占位行", async (query, draft) => {
    const send = vi.fn(async () => undefined);
    const view = await render_page({ send });
    const editor = EditorView.findFromDOM(view.querySelector<HTMLElement>(".cm-content")!);
    if (editor === null) throw new Error("缺少 Composer");
    await act(async () =>
      editor.dispatch({
        changes: { from: 0, insert: query },
        selection: EditorSelection.cursor(query.length),
      }),
    );
    const instruction = view.querySelector<HTMLButtonElement>(
      '[aria-labelledby="agent-mention-instructions-label"] [role="option"]',
    );
    if (instruction === null) throw new Error("缺少预置草稿指令");

    await act(async () => instruction.click());
    const { from, to } = editor.state.selection.main;
    expect(editor.state.doc.toString()).toBe(draft);
    expect(from).toBe(draft.indexOf("app.agent_input.path_placeholder"));
    expect(editor.state.sliceDoc(from, to)).toBe("app.agent_input.path_placeholder");
    expect(send).not.toHaveBeenCalled();
  });

  it("恢复失败时显示单一重试入口并重新连接", async () => {
    const reconnect = vi.fn();
    const view = await render_page({ transport: "restore_failed", reconnect });
    const alert = view.querySelector<HTMLElement>('[role="status"]');
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

  it("停止收尾状态禁用发送，结算后恢复操作", async () => {
    runtime_state.current = { revision: 1, owner: "agent" };
    const view = await render_page({ state: "stopping" });
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

  it("页面根据实际队列容量禁用新增发送", async () => {
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
          endedAt: null,
          id: "apply-1",
          toolName: "workspace_apply",
          input: "{}",
          imageCount: 0,
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

  it("选择期间锁定操作区，Esc 只作用于前台待决卡片，离场后恢复编辑", async () => {
    const pending_write_decision = {
      kind: "write_approval" as const,
      id: "apply-1",
      summary: {
        items: 1,
        glossary: 0,
        textPreserve: 0,
        preReplacement: 0,
        postReplacement: 0,
        files: 0,
        knowledge: 0,
        prompts: 0,
      },
    };
    const input: AgentInputState = {
      ...build_state().input,
      draft: new AgentInputDraft(null, {
        text: "",
        attachments: [
          { kind: "response_annotation", selectedText: "需要复核的段落", comment: "检查人称" },
        ],
      }),
    };
    const send = vi.fn(async () => undefined);
    const resolveWriteApproval = vi.fn(async () => undefined);
    const waiting = {
      input,
      send,
      doing: "核验结果",
      pendingDecision: pending_write_decision,
      resolveWriteApproval,
    };
    const view = await render_page({ input, send, doing: "检查章节" });
    const host = view.querySelector<HTMLElement>(".cm-content")!;
    const editor = EditorView.findFromDOM(host)!;
    await act(async () => {
      editor.dispatch({ changes: { from: 0, insert: "保留这份草稿" }, selection: { anchor: 3 } });
      host.focus();
    });
    await render_page(waiting);
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
    const press_escape = () =>
      act(async () =>
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      );
    await render_page(waiting, false);
    await press_escape();
    expect(resolveWriteApproval).not.toHaveBeenCalled();
    await render_page(waiting);

    // jsdom 没有布局和原生动画，用非零占位让卡片保留到离场完成。
    const region = view.querySelector(".agent-page__bottom-region")!;
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 720, 120));
    vi.spyOn(Element.prototype, "animate").mockImplementation(
      () => ({ cancel: vi.fn() }) as unknown as Animation,
    );
    await render_page({ ...waiting, pendingDecision: null });
    expect(view.querySelector(".agent-decision")).not.toBeNull();
    await press_escape();
    expect(resolveWriteApproval).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(view.querySelector(".agent-doing__text")?.textContent).toBe("核验结果");
    expect(view.querySelector(".agent-doing .agent-status-mark--running")).toBeNull();
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
          createdAt: null,
          id: "compaction-1",
          status: "error",
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

  it("压缩失败块复用压缩命令、可用性和错误反馈", async () => {
    const compactContext = vi.fn(async () => undefined);
    const entries: AgentEntry[] = [
      user_entry("user", "检查", "success", 0, 1_000),
      { kind: "context_compaction", createdAt: null, id: "compact", status: "error" },
    ];
    const options = {
      entries,
      context: { tokens: 64_000, compactable: true, limits: null },
      compactContext,
    };
    const view = await render_page(options);
    const retry = view.querySelector<HTMLButtonElement>(
      "button.agent-process-entry:not([aria-haspopup])",
    );
    expect(retry?.disabled).toBe(false);
    await act(async () => retry?.click());
    expect(compactContext).toHaveBeenCalledOnce();

    await render_page({ ...options, command: "compact" });
    expect(retry?.disabled).toBe(true);
    await render_page({ ...options, state: "running" });
    expect(retry?.disabled).toBe(true);
    await render_page({ ...options, transport: "disconnected" });
    expect(retry?.disabled).toBe(true);
    await render_page({ ...options, context: { tokens: 0, compactable: false, limits: null } });
    expect(retry?.disabled).toBe(true);
    runtime_state.current = { revision: 1, owner: "batch_translation" };
    await render_page(options);
    expect(retry?.disabled).toBe(false);
    const error = new Error("offline");
    compactContext.mockRejectedValueOnce(error);
    await act(async () => retry?.click());
    expect(push_toast).toHaveBeenCalledWith("agent_page.error.compact", error);
  });

  it("停止命令失败时保留运行态并显示错误 Toast", async () => {
    const stop = vi.fn(() => Promise.reject(new Error("offline")));
    const view = await render_page({ state: "running", stop });
    await act(async () => {
      get_button_by_label(view, "agent_page.action.stop").click();
      await vi.waitFor(() =>
        expect(push_toast).toHaveBeenCalledWith("agent_page.error.stop", expect.any(Error)),
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

    expect(push_toast).toHaveBeenCalledWith("agent_page.error.send", expect.any(Error));
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
    const scenario = {
      entries: [user_entry("user-error", "重新检查术语", "error", 1, 2)],
      send,
      continue: continue_session,
    };
    const view = await render_page({ ...scenario, state: "running" });
    expect(view.querySelector(".agent-continue-entry")).toBeNull();
    await render_page(scenario);
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
    const reviseRound = vi.fn(async () => undefined);
    const entries = [
      user_entry("user-write", "原输入", "success", 0, 3),
      workspace_apply_entry("apply-1"),
      assistant_entry("assistant-write", "原输出", "success", 2),
    ];
    const ordinary_input = build_state().input;
    ordinary_input.draft.write({ text: "普通草稿", attachments: [] });
    const view = await render_page({
      entries,
      reviseRound,
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
    expect(reviseRound).toHaveBeenCalledWith("user-write", {
      text: "新输入",
      attachments: [],
    });
    expect(ordinary_input.replace_history).toHaveBeenCalledWith("原输入", "新输入");
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    reviseRound.mockClear();
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
    expect(reviseRound).toHaveBeenCalledWith("assistant-write", {
      text: "新输出",
      attachments: [],
    });
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("原位输入修改受理失败时保留编辑内容并显示修改错误", async () => {
    const reviseRound = vi.fn(() => Promise.reject(new Error("offline")));
    const view = await render_page({
      entries: [user_entry("user-1", "原输入", "success", 0, 1)],
      reviseRound,
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
      expect(push_toast).toHaveBeenCalledWith("app.feedback.modify_failed", expect.any(Error)),
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

  it("导出后显示点星胶囊，换到新导出轮次时关闭上一轮弹窗", async () => {
    const view = await render_page();
    const prompt = () => view.querySelector<HTMLButtonElement>(".agent-star-prompt");
    const dialog = () => document.querySelector('[data-slot="alert-dialog-content"][data-open]');
    expect(prompt()).toBeNull();

    await render_page({ exportedRoundId: "first-export" });
    await act(async () => prompt()!.click());
    expect(dialog()).not.toBeNull();

    await render_page({ exportedRoundId: "next-export" });
    expect(prompt()).not.toBeNull();
    expect(dialog()).toBeNull();
  });

  it("完整轮次只在最后回复提供分叉，取消不提交，失败保留弹窗", async () => {
    const forkRound = vi.fn(async () => {
      throw new Error("offline");
    });
    const view = await render_page({
      forkRound,
      entries: [
        user_entry("user-1", "第一问", "success", 0, 1),
        assistant_entry("middle", "中间回复", "success", 1),
        assistant_entry("final", "最终回复", "success", 2),
        user_entry("user-2", "第二问", "success", 3, 4),
        assistant_entry("final-2", "第二答", "success", 4),
      ],
    });
    const buttons = [
      ...view.querySelectorAll<HTMLButtonElement>(".agent-message-actions button"),
    ].filter((button) => button.textContent === "agent_page.action.fork");
    expect(buttons).toHaveLength(2);
    await act(async () => buttons[0]!.click());
    await act(async () => get_portal_cancel_button().click());
    expect(forkRound).not.toHaveBeenCalled();
    await act(async () => buttons[0]!.click());
    await act(async () => get_portal_action_button().click());
    expect(forkRound).toHaveBeenCalledWith("user-1");
    expect(document.body.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
    expect(push_toast).toHaveBeenCalledWith("app.feedback.modify_failed", expect.any(Error));
  });
});

/** 每次渲染创建独立会话快照，场景仅覆盖所需字段。 */
function build_state(overrides: Partial<AgentPageState> = {}): AgentPageState {
  return {
    state: "idle",
    pendingDecision: null,
    exportedRoundId: null,
    entries: [
      user_entry("user-1", "开始", "success", 0, 1),
      assistant_entry("assistant-1", "**变更方案**", "success", 1),
    ],
    skills: [],
    inputQueue: { paused: false, canSendNow: false, items: [] },
    doing: null,
    context: { tokens: null, compactable: false, limits: null },
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    transport: "ready",
    command: null,
    input: {
      revision: 0,
      draft: new AgentInputDraft(api_upload),
      read_history: () => [],
      replace_history: vi.fn(),
    },
    send: vi.fn(async () => undefined),
    forkRound: vi.fn(async () => undefined),
    reviseRound: vi.fn(async () => undefined),
    updateQueuedMessage: vi.fn(async () => undefined),
    deleteQueuedMessage: vi.fn(async () => undefined),
    reorderQueuedMessages: vi.fn(async () => undefined),
    sendQueuedMessage: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    compactContext: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    stop: vi.fn(),
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
    endedAt: 3,
    id,
    toolName: "workspace_apply",
    input: "{}",
    imageCount: 0,
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

/** 通过合并后的模型菜单选择思考等级。 */
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
  ].find((item) => item.textContent === "Agent Model")!;
  await act(async () =>
    model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
  );
  const option = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (option === undefined) throw new Error(`缺少思考等级：${label}`);
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

const test_timeline = new AgentTimelineStore(); // 页面交互夹具通过真实结构索引提供订阅快照。
let test_timeline_entries: readonly AgentEntry[] | undefined;
/** 只在夹具条目集合替换后更新索引，模拟稳定的结构快照。 */
function read_test_timeline(): AgentTimelineStore {
  if (test_timeline_entries !== page_state.current.entries) {
    test_timeline_entries = page_state.current.entries;
    test_timeline.replace(test_timeline_entries);
  }
  return test_timeline;
}
