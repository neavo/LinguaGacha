import { act, createRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteCharBackward } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GlossaryEntry } from "@domain/quality";
import type { AgentInputSession } from "@frontend/app/session/agent/agent-session-context";

import { AgentComposer, type AgentComposerHandle } from "./agent-composer";

type AgentComposerTestProps = ComponentProps<typeof AgentComposer>;
type RenderComposerOptions = Partial<
  Pick<
    AgentComposerTestProps,
    | "can_reset"
    | "command"
    | "compacting"
    | "compaction_failed"
    | "context_tokens"
    | "on_image_error"
    | "on_reset"
    | "on_send"
    | "on_stop"
    | "running"
    | "stop_disabled"
    | "term_hit_counts"
    | "terms"
    | "unavailable_reason"
  >
> & {
  composer_ref?: RefObject<AgentComposerHandle | null>;
  input_session?: AgentInputSession;
  model_selection?: { loading?: boolean; updating?: boolean };
};

type TestAgentInputSession = AgentInputSession & {
  accept_message: () => void;
};

/** 只列当前组件断言涉及的可见文案，其余 key 原样返回以便定位。 */
const TEST_MESSAGES = vi.hoisted(() => ({
  "agent_page.input.placeholder": "描述任务，或输入 @ 选择技能或术语 …",
  "agent_page.input.hint": "Enter 发送 · Shift + Enter 换行",
  "agent_page.input.drop_images": "松开以添加图片",
  "agent_page.mention.groups.skills": "技能",
  "agent_page.mention.groups.terms": "术语",
  "agent_page.mention.no_matches": "没有匹配的项目 …",
  "agent_page.context_usage_warning": "即将自动压缩上下文",
  "agent_page.compaction.running": "正在压缩上下文 …",
  "agent_page.action.send": "发送",
  "agent_page.action.stop": "停止",
  "agent_page.action.applying": "正在应用工程修改，完成前不可停止",
  "agent_page.action.add_image": "添加图片",
  "agent_page.unavailable.restoring": "正在恢复会话",
  "agent_page.unavailable.runtime_busy": "其它任务正在运行",
  "agent_page.unavailable.settling": "正在结束当前任务",
  "app.model.selection.label": "选择模型",
  "app.model.thinking_level.label": "思考等级",
  "app.model.thinking_level.medium": "中",
}));

const image_mocks = vi.hoisted(() => ({
  normalize_agent_images: vi.fn(async (files: Iterable<File>) =>
    Array.from(files, (file) => `webp-${file.name}`),
  ),
}));

vi.mock("./agent-image", () => ({
  AGENT_IMAGE_FILE_ACCEPT: ".png,.jpg,.jpeg,.bmp,.webp,.avif",
  normalize_agent_images: image_mocks.normalize_agent_images,
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string, params?: Record<string, string>) =>
      key === "agent_page.mention.term_hits"
        ? `${params?.["count"]} 次`
        : (TEST_MESSAGES[key as keyof typeof TEST_MESSAGES] ?? key),
  }),
}));

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

const terms: GlossaryEntry[] = [
  { entry_id: "alice", src: "Alice Smith", dst: "爱丽丝", info: "女主角", case_sensitive: false },
  { entry_id: "bob", src: "Bob", dst: "鲍勃", info: "", case_sensitive: false },
  { entry_id: "carol", src: "Carol", dst: "", info: "反派角色", case_sensitive: false },
  { entry_id: "delta", src: "Delta", dst: "", info: "角色", case_sensitive: false },
  { entry_id: "echo", src: "Echo", dst: "", info: "角色", case_sensitive: false },
  { entry_id: "foxtrot", src: "Foxtrot", dst: "", info: "角色", case_sensitive: false },
  { entry_id: "golf", src: "Golf", dst: "", info: "角色", case_sensitive: false },
  { src: "", dst: "空源", info: "角色", case_sensitive: false },
];
const term_hit_counts = { alice: 7, bob: 2, carol: 0, delta: 1, echo: 3 };

describe("AgentComposer", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let default_input_session: TestAgentInputSession | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    default_input_session = null;
    image_mocks.normalize_agent_images.mockClear();
  });

  it("选择能力和术语插入字面量，活动索引跨分组连续移动", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ on_send });
    const editor = get_editor(view);
    const content = editor.contentDOM;

    await set_document(editor, "前 @glo", 6);
    await dispatch_key(content, "Enter");
    expect(editor.state.doc.toString()).toBe("前 @skill(glossary-audit) ");
    expect(view.querySelector(".agent-mention-token > span")?.textContent).toBe(
      "@skill(glossary-audit)",
    );

    await set_document(editor, "@", 1);
    await dispatch_key(content, "ArrowDown");
    await dispatch_key(content, "ArrowDown");
    expect(content.getAttribute("aria-activedescendant")).toBe("agent-mention-option-2");
    await dispatch_key(content, "Enter");
    expect(editor.state.doc.toString()).toBe("@term(Alice Smith) ");
    expect(view.querySelector(".agent-mention-token > span")?.textContent).toBe(
      "@term(Alice Smith)",
    );

    await set_document(editor, "@Bob", 4);
    const option = await wait_for_element(view, '[role="option"]');
    const mouse_down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    expect(option.dispatchEvent(mouse_down)).toBe(false);
    await act(async () => option.click());
    expect(editor.state.doc.toString()).toBe("@term(Bob) ");
    await click_send(view);
    expect(on_send).toHaveBeenCalledWith({ text: "@term(Bob)", images: [] });
  });

  it("方向键导航到深层候选时把活动项滚入菜单可视区域", async () => {
    const scroll_into_view = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    try {
      const view = await render_composer({
        terms: Array.from({ length: 24 }, (_, index) => ({
          src: `Character ${index.toString()}`,
          dst: `角色 ${index.toString()}`,
          info: "角色",
          case_sensitive: false,
        })),
      });
      const editor = get_editor(view);

      await set_document(editor, "@角色", 3);
      scroll_into_view.mockClear();
      for (let index = 0; index < 10; index += 1) {
        await dispatch_key(editor.contentDOM, "ArrowDown");
      }

      expect(scroll_into_view.mock.contexts.at(-1)).toBe(
        view.querySelector("#agent-mention-option-10"),
      );
      expect(scroll_into_view).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      scroll_into_view.mockRestore();
    }
  });

  it("已知 marker 在输入框中整块显示和删除，底层仍保留原始文本", async () => {
    const view = await render_composer();
    const editor = get_editor(view);
    const marker = "@term(Alice Smith)";
    await set_document(editor, marker, marker.length);

    expect(view.querySelector(".agent-mention-token > span")?.textContent).toBe(marker);
    expect(editor.state.doc.toString()).toBe(marker);
    await act(async () => expect(deleteCharBackward(editor)).toBe(true));
    expect(editor.state.doc.toString()).toBe("");
  });

  it("零结果保持菜单空态，方向键不访问非法索引，Enter 仍发送正文", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ on_send });
    const editor = get_editor(view);
    await set_document(editor, "@missing", 8);
    const menu = await wait_for_element(view, '[role="listbox"]');
    expect(menu.textContent).toBe("没有匹配的项目 …");
    expect(menu.querySelector('[role="option"]')).toBeNull();
    expect(editor.contentDOM.hasAttribute("aria-activedescendant")).toBe(false);
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("@missing");
    await dispatch_key(editor.contentDOM, "Enter");
    expect(on_send).toHaveBeenCalledWith({ text: "@missing", images: [] });
  });

  it("Escape 关闭当前菜单，查询变化后重新打开", async () => {
    const view = await render_composer();
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await wait_for_element(view, '[role="listbox"]');
    await dispatch_key(editor.contentDOM, "Escape");
    expect(view.querySelector('[role="listbox"]')).toBeNull();
    expect(editor.state.doc.toString()).toBe("@g");
    await act(async () =>
      editor.dispatch({
        changes: { from: 2, insert: "l" },
        selection: EditorSelection.cursor(3),
      }),
    );
    expect(await wait_for_element(view, '[role="listbox"]')).not.toBeNull();
  });

  it("Shift+Enter 换行，IME composing 期间 Enter 不选择也不发送", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ on_send });
    const editor = get_editor(view);
    await set_document(editor, "正文", 2);
    await dispatch_key(editor.contentDOM, "Enter", true);
    expect(editor.state.doc.toString()).toBe("正文\n");

    await set_document(editor, "@glo", 4);
    await dispatch_key(editor.contentDOM, "Enter", false, true);
    expect(editor.state.doc.toString()).toBe("@glo");
    expect(on_send).not.toHaveBeenCalled();
  });

  it("用纯文本历史双向浏览并恢复当前草稿", async () => {
    const input_session = create_input_session(["第一条", "检查 @skill(glossary-audit) 完成"]);
    const view = await render_composer({ input_session });
    const editor = get_editor(view);
    await set_document(editor, "当前草稿", 4);
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("检查 @skill(glossary-audit) 完成");
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("第一条");
    await dispatch_key(editor.contentDOM, "ArrowDown");
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("当前草稿");
  });

  it("历史导航只从视觉首行启动，并在用户编辑后退出", async () => {
    const input_session = create_input_session(["历史消息"]);
    const view = await render_composer({ input_session });
    const editor = get_editor(view);
    const draft = "第一行\n第二行";
    await set_document(editor, draft, draft.length);

    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe(draft);
    await act(async () => {
      editor.dispatch({ selection: EditorSelection.cursor(0) });
    });
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("历史消息");

    await act(async () =>
      editor.dispatch({
        changes: { from: editor.state.doc.length, insert: "！" },
        selection: EditorSelection.cursor(editor.state.doc.length + 1),
      }),
    );
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("历史消息！");
  });

  it("跨重渲染保留完整草稿，并在受理后同步清空编辑器", async () => {
    const input_session = create_input_session();
    const composer_ref = createRef<AgentComposerHandle>();
    const on_send = vi.fn();
    const view = await render_composer({ composer_ref, input_session, on_send });
    await act(async () => composer_ref.current?.write_draft("  检查 @skill(glossary-audit)  "));
    await click_send(view);
    expect(on_send).toHaveBeenCalledWith({
      text: "检查 @skill(glossary-audit)",
      images: [],
    });
    input_session.accept_message();
    await render_composer({ composer_ref, input_session, on_send });
    expect(get_editor(view).state.doc.toString()).toBe("");
  });

  it("文件选择后允许发送纯图片并可移除缩略图", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ on_send });
    const input = view.querySelector<HTMLInputElement>(".agent-composer__file-input");
    if (input === null) throw new Error("缺少图片文件输入");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([], "a.png", { type: "image/png" })],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(view.querySelectorAll(".agent-composer__attachment")).toHaveLength(1);
    expect(view.querySelector<HTMLImageElement>(".agent-composer__attachment img")?.alt).toBe("");
    const remove_button = view.querySelector<HTMLButtonElement>(
      ".agent-composer__attachment-remove",
    );
    expect(remove_button?.getAttribute("aria-label")).toBe("app.action.close");
    await click_send(view);
    expect(on_send).toHaveBeenCalledWith({ text: "", images: ["webp-a.png"] });

    await act(async () => {
      remove_button?.click();
    });
    expect(view.querySelectorAll(".agent-composer__attachment")).toHaveLength(0);
  });

  it("拖入与粘贴图片均按顺序追加到草稿", async () => {
    const input_session = create_input_session();
    const view = await render_composer({ input_session });
    const form = view.querySelector<HTMLFormElement>(".agent-composer");
    if (form === null) throw new Error("缺少 Composer 表单");
    const dropped = new File([], "drop.webp", { type: "image/webp" });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["Files"], files: [dropped], dropEffect: "none" },
    });
    await act(async () => {
      form.dispatchEvent(drop);
      await Promise.resolve();
    });

    const pasted = new File([], "paste.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [pasted] } });
    await act(async () => {
      form.dispatchEvent(paste);
      await Promise.resolve();
    });

    expect(input_session.read_draft()).toEqual({
      text: "",
      images: ["webp-drop.webp", "webp-paste.png"],
    });
    expect(view.querySelectorAll(".agent-composer__attachment")).toHaveLength(2);
  });

  it("累计只接收前十张图片，满额后静默忽略新输入", async () => {
    const input_session = create_input_session();
    const existing_images = Array.from({ length: 8 }, (_, index) => `existing-${index + 1}`);
    input_session.write_draft({ text: "", images: existing_images });
    const on_image_error = vi.fn();
    const view = await render_composer({ input_session, on_image_error });
    const input = view.querySelector<HTMLInputElement>(".agent-composer__file-input");
    const image_trigger = view.querySelector<HTMLButtonElement>(".agent-composer__image-trigger");
    if (input === null || image_trigger === null) throw new Error("缺少图片输入控件");
    const selected = Array.from(
      { length: 5 },
      (_, index) => new File([], `selected-${index + 1}.png`, { type: "image/png" }),
    );
    Object.defineProperty(input, "files", { configurable: true, value: selected });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(input_session.read_draft()).toEqual({
      text: "",
      images: [...existing_images, "webp-selected-1.png", "webp-selected-2.png"],
    });
    expect(view.querySelectorAll(".agent-composer__attachment")).toHaveLength(10);
    expect(image_trigger.disabled).toBe(true);

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [new File([], "ignored.png", { type: "image/png" })] },
    });
    await act(async () => {
      view.querySelector(".agent-composer")?.dispatchEvent(paste);
      await Promise.resolve();
    });

    expect(on_image_error).not.toHaveBeenCalled();

    await act(async () => {
      view.querySelector<HTMLButtonElement>(".agent-composer__attachment-remove")?.click();
    });
    expect(image_trigger.disabled).toBe(false);
  });

  it("图片转换失败时保留原草稿并交给页面提示", async () => {
    image_mocks.normalize_agent_images.mockRejectedValueOnce(new Error("decode failed"));
    const on_image_error = vi.fn();
    const input_session = create_input_session();
    const view = await render_composer({ input_session, on_image_error });
    const input = view.querySelector<HTMLInputElement>(".agent-composer__file-input");
    if (input === null) throw new Error("缺少图片文件输入");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([], "broken.avif", { type: "image/avif" })],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(on_image_error).toHaveBeenCalledOnce();
    expect(input_session.read_draft()).toEqual({ text: "", images: [] });
    expect(view.querySelector(".agent-composer__attachment")).toBeNull();
  });

  it("运行态仍可编辑，只由按钮停止当前任务", async () => {
    const on_send = vi.fn();
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, on_send, on_stop });
    const editor = get_editor(view);
    await set_document(editor, "继续补充", 4);
    expect(editor.state.readOnly).toBe(false);
    await click_send(view);
    expect(on_stop).toHaveBeenCalledOnce();
    expect(on_send).not.toHaveBeenCalled();
  });

  it("apply 运行期间禁用停止并解释不可取消阶段", async () => {
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, stop_disabled: true, on_stop });
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");

    expect(submit?.disabled).toBe(true);
    expect(submit?.getAttribute("aria-label")).toBe("正在应用工程修改，完成前不可停止");
    await act(async () => submit?.click());
    expect(on_stop).not.toHaveBeenCalled();
  });

  it("压缩期间保留草稿编辑但禁用停止，失败后阻止发送并允许切换模型", async () => {
    const on_send = vi.fn();
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, compacting: true, on_send, on_stop });
    const editor = get_editor(view);
    await set_document(editor, "继续补充", 4);
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");
    expect(editor.state.readOnly).toBe(false);
    expect(submit?.disabled).toBe(true);
    expect(submit?.getAttribute("aria-label")).toBe("正在压缩上下文 …");
    await act(async () => submit?.click());
    expect(on_stop).not.toHaveBeenCalled();

    await render_composer({
      running: false,
      compacting: false,
      compaction_failed: true,
      on_send,
      on_stop,
    });
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__submit")?.disabled).toBe(true);
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__model-trigger")?.disabled).toBe(
      false,
    );
  });

  async function render_composer(options: RenderComposerOptions = {}): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
    }
    root ??= createRoot(container);
    await act(async () => {
      default_input_session ??= create_input_session();
      root?.render(
        <AgentComposer
          ref={options.composer_ref}
          skills={skills}
          terms={options.terms ?? terms}
          term_hit_counts={options.term_hit_counts ?? term_hit_counts}
          running={options.running ?? false}
          stop_disabled={options.stop_disabled ?? false}
          compacting={options.compacting ?? false}
          compaction_failed={options.compaction_failed ?? false}
          unavailable_reason={options.unavailable_reason ?? null}
          command={options.command ?? null}
          can_reset={options.can_reset ?? true}
          context_tokens={options.context_tokens ?? null}
          model_selection={{
            snapshot: {
              model_selection: { translation: "preset", analysis: "preset", agent: "agent" },
              models: [
                {
                  id: "agent",
                  type: "CUSTOM_OPENAI",
                  name: "Agent Model",
                  agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
                  thinking_level: "MEDIUM",
                  thinking_configurable: true,
                },
              ],
            },
            loading: false,
            updating: false,
            select_model: vi.fn(async () => undefined),
            update_thinking_level: vi.fn(async () => undefined),
            ...options.model_selection,
          }}
          input_session={options.input_session ?? default_input_session}
          on_send={options.on_send ?? vi.fn()}
          on_image_error={options.on_image_error ?? vi.fn()}
          on_stop={options.on_stop ?? vi.fn(async () => undefined)}
          on_reset={options.on_reset ?? vi.fn()}
        />,
      );
    });
    return container;
  }
});

function get_editor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) throw new Error("缺少 CodeMirror 编辑器");
  return editor;
}

/** 组件测试只模拟草稿与历史读取契约，持久化责任由 Provider 和历史 helper 单独验证。 */
function create_input_session(history: readonly string[] = []): TestAgentInputSession {
  let draft = { text: "", images: [] as string[] };
  const session: TestAgentInputSession = {
    revision: 0,
    read_draft: () => draft,
    write_draft: (next_draft) => {
      draft = next_draft;
    },
    read_history: () => history,
    accept_message: () => {
      draft = { text: "", images: [] };
      session.revision += 1;
    },
  };
  return session;
}

async function set_document(editor: EditorView, text: string, head: number): Promise<void> {
  await act(async () => {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      selection: EditorSelection.cursor(head),
    });
  });
}

async function click_send(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(".agent-composer__submit");
  if (button === null) throw new Error("缺少发送按钮");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

async function wait_for_element(container: HTMLElement, selector: string): Promise<HTMLElement> {
  let element: HTMLElement | null = null;
  await act(async () => {
    await vi.waitFor(() => {
      element = container.querySelector<HTMLElement>(selector);
      expect(element).not.toBeNull();
    });
  });
  if (element === null) throw new Error(`缺少元素：${selector}`);
  return element;
}

async function dispatch_key(
  content: HTMLElement,
  key: string,
  shiftKey = false,
  isComposing = false,
): Promise<void> {
  await act(async () => {
    content.focus();
    const event = new KeyboardEvent("keydown", {
      key,
      code: key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "isComposing", { value: isComposing });
    content.dispatchEvent(event);
  });
}
