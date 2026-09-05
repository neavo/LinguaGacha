import { act, createElement, createRef, type ComponentProps, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteCharBackward } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  AGENT_MESSAGE_IMAGE_LIMIT,
  type AgentMessageAttachment,
  type AgentMessageInput,
} from "@shared/agent";
import type { AgentInputSession } from "@frontend/app/session/agent/agent-session-context";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

import { AgentComposer, type AgentComposerHandle } from "./agent-composer";

type AgentComposerTestProps = ComponentProps<typeof AgentComposer>;
type RenderComposerOptions = Partial<
  Pick<
    AgentComposerTestProps,
    | "can_reset"
    | "approval_mode"
    | "approval_mode_disabled"
    | "can_continue_queue"
    | "command"
    | "compacting"
    | "context_tokens"
    | "instructions"
    | "inline_role"
    | "locked"
    | "on_cancel_edit"
    | "on_image_error"
    | "on_reset"
    | "on_send"
    | "on_stop"
    | "on_approval_mode_change"
    | "presentation"
    | "queue_full"
    | "running"
    | "stop_disabled"
    | "skills"
    | "unavailable_reason"
  >
> & {
  composer_ref?: RefObject<AgentComposerHandle | null>;
  input_session?: AgentInputSession;
  model_selection?: Partial<AgentComposerTestProps["model_selection"]>;
};

type TestAgentInputSession = AgentInputSession & {
  accept_message: () => void;
};

const image_mocks = vi.hoisted(() => ({
  normalize_agent_images: vi.fn(async (files: Iterable<File>) =>
    Array.from(files, (file) => `webp-${file.name}`),
  ),
}));

vi.mock("./agent-image", () => ({
  AGENT_IMAGE_FILE_ACCEPT: ".png,.jpg,.jpeg,.bmp,.webp,.avif",
  normalize_agent_images: image_mocks.normalize_agent_images,
}));

vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
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

  it("选择技能插入 marker，选择压缩指令则移除筛选文本并立即执行", async () => {
    const on_send = vi.fn();
    const on_compact = vi.fn();
    const view = await render_composer({
      on_send,
      instructions: [
        {
          id: "compact_context",
          title: "压缩上下文",
          description: "",
          disabled: false,
          execute: on_compact,
        },
      ],
    });
    const editor = get_editor(view);
    const content = editor.contentDOM;

    await set_document(editor, "前 @glo", 6);
    await dispatch_key(content, "Enter");
    expect(editor.state.doc.toString()).toBe("前 @skill(glossary-audit) ");
    expect(view.querySelector(".agent-mention-token > span")?.textContent).toBe(
      "@skill(glossary-audit)",
    );

    await set_document(editor, "前 @compact 后", 10);
    await dispatch_key(content, "Enter");
    expect(editor.state.doc.toString()).toBe("前  后");
    expect(on_compact).toHaveBeenCalledOnce();
    expect(on_send).not.toHaveBeenCalled();
  });

  it("禁用的压缩指令保持筛选文本且不可触发", async () => {
    const on_compact = vi.fn();
    const view = await render_composer({
      instructions: [
        {
          id: "compact_context",
          title: "压缩上下文",
          description: "当前上下文较少，无需压缩",
          disabled: true,
          execute: on_compact,
        },
      ],
    });
    const editor = get_editor(view);
    await set_document(editor, "@compact", 8);
    const option = (await wait_for_element(view, '[role="option"]')) as HTMLButtonElement;

    expect(option.disabled).toBe(true);
    await dispatch_key(editor.contentDOM, "Enter");
    expect(editor.state.doc.toString()).toBe("@compact");
    expect(on_compact).not.toHaveBeenCalled();
  });

  it("方向键导航到深层技能候选时把活动项滚入菜单可视区域", async () => {
    const scroll_into_view = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    try {
      const view = await render_composer({
        skills: Array.from({ length: 24 }, (_, index) => ({
          name: `skill-${index.toString()}`,
          displayDescriptions: {
            "zh-CN": `角色能力 ${index.toString()}`,
            "en-US": "",
            "de-DE": "",
          },
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

  it("技能 marker 在输入框中整块显示和删除，底层仍保留原始文本", async () => {
    const view = await render_composer();
    const editor = get_editor(view);
    const marker = "@skill(glossary-audit)";
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
    expect(menu.querySelector('[role="option"]')).toBeNull();
    expect(editor.contentDOM.hasAttribute("aria-activedescendant")).toBe(false);
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("@missing");
    await dispatch_key(editor.contentDOM, "Enter");
    expect(on_send).toHaveBeenCalledWith({ text: "@missing", attachments: [] });
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

  it("原位编辑先关闭候选，再由 Escape 取消", async () => {
    const on_cancel_edit = vi.fn();
    const view = await render_composer({
      presentation: "inline",
      inline_role: "user",
      on_cancel_edit,
    });
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await wait_for_element(view, '[role="listbox"]');

    await dispatch_key(editor.contentDOM, "Escape");
    expect(view.querySelector('[role="listbox"]')).toBeNull();
    expect(on_cancel_edit).not.toHaveBeenCalled();
    await dispatch_key(editor.contentDOM, "Escape");

    expect(on_cancel_edit).toHaveBeenCalledOnce();
  });

  it("原位编辑仅在动作有效时声明并接管快捷键", async () => {
    const on_cancel_edit = vi.fn();
    const view = await render_composer({
      presentation: "inline",
      inline_role: "user",
      on_cancel_edit,
    });
    const editor = get_editor(view);
    await set_document(editor, "修改内容", 4);

    let save = view.querySelector<HTMLButtonElement>(".agent-composer__inline-submit");
    let cancel = view.querySelector<HTMLButtonElement>("button[aria-label='app.action.cancel']");
    expect(save?.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(cancel?.getAttribute("aria-keyshortcuts")).toBe("Escape");

    await render_composer({
      presentation: "inline",
      inline_role: "user",
      locked: true,
      on_cancel_edit,
    });
    save = view.querySelector<HTMLButtonElement>(".agent-composer__inline-submit");
    cancel = view.querySelector<HTMLButtonElement>("button[aria-label='app.action.cancel']");
    expect(save?.disabled).toBe(true);
    expect(cancel?.disabled).toBe(true);
    expect(save?.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(cancel?.hasAttribute("aria-keyshortcuts")).toBe(false);

    const escape_event = await dispatch_key(editor.contentDOM, "Escape");
    expect(escape_event.defaultPrevented).toBe(false);
    expect(on_cancel_edit).not.toHaveBeenCalled();
  });

  it("新任务快捷键复用按钮可用性并允许从主输入器触发", async () => {
    const on_reset = vi.fn();
    const view = await render_composer({ on_reset });
    const editor = get_editor(view);
    const trigger = (): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        key: "n",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      editor.contentDOM.dispatchEvent(event);
      return event;
    };

    let event: KeyboardEvent | undefined;
    await act(async () => {
      event = trigger();
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(on_reset).toHaveBeenCalledOnce();
    expect(view.querySelector(".agent-composer__reset")?.hasAttribute("aria-keyshortcuts")).toBe(
      true,
    );

    await render_composer({ can_reset: false, on_reset });
    await act(async () => {
      event = trigger();
    });
    expect(event?.defaultPrevented).toBe(false);
    expect(on_reset).toHaveBeenCalledOnce();
    expect(view.querySelector(".agent-composer__reset")?.hasAttribute("aria-keyshortcuts")).toBe(
      false,
    );
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
      attachments: [],
    });
    input_session.accept_message();
    await render_composer({ composer_ref, input_session, on_send });
    expect(get_editor(view).state.doc.toString()).toBe("");
  });

  it("文件选择后允许发送纯图片并从预览删除", async () => {
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
    expect(view.querySelectorAll(".agent-attachment")).toHaveLength(1);
    await click_send(view);
    expect(on_send).toHaveBeenCalledWith({
      text: "",
      attachments: image_attachments("webp-a.png"),
    });

    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="agent_page.image.title 1"]')
        ?.click(),
    );
    const remove = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "app.action.delete",
    );
    await act(async () => remove?.click());
    expect(view.querySelectorAll(".agent-attachment")).toHaveLength(0);
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
      attachments: image_attachments("webp-drop.webp", "webp-paste.png"),
    });
    expect(view.querySelectorAll(".agent-attachment")).toHaveLength(2);
  });

  it("达到图片上限后静默忽略新输入，删除后恢复入口", async () => {
    const input_session = create_input_session();
    const existing_images = Array.from(
      { length: AGENT_MESSAGE_IMAGE_LIMIT - 2 },
      (_, index) => `existing-${index + 1}`,
    );
    input_session.write_draft({ text: "", attachments: image_attachments(...existing_images) });
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

    const full_draft = {
      text: "",
      attachments: image_attachments(
        ...existing_images,
        "webp-selected-1.png",
        "webp-selected-2.png",
      ),
    };
    expect(input_session.read_draft()).toEqual(full_draft);
    expect(view.querySelectorAll(".agent-attachment")).toHaveLength(AGENT_MESSAGE_IMAGE_LIMIT);
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
    expect(input_session.read_draft()).toEqual(full_draft);

    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="agent_page.image.title 1"]')
        ?.click(),
    );
    const remove = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "app.action.delete",
    );
    await act(async () => remove?.click());
    expect(image_trigger.disabled).toBe(false);
  });

  it("新增批注在修改后随完整消息提交", async () => {
    const composer_ref = createRef<AgentComposerHandle>();
    const input_session = create_input_session();
    const on_send = vi.fn();
    const view = await render_composer({ composer_ref, input_session, on_send });

    await act(async () =>
      composer_ref.current?.add_response_annotation({
        kind: "response_annotation",
        selectedText: "旧回复",
        comment: "原评论",
      }),
    );
    expect(input_session.read_draft().attachments).toEqual([
      { kind: "response_annotation", selectedText: "旧回复", comment: "原评论" },
    ]);

    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="agent_page.annotation.title 1"]')
        ?.click(),
    );
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      ".agent-composer__annotation-editor textarea",
    );
    if (textarea === null) throw new Error("缺少批注编辑器");
    await act(async () => {
      set_textarea_value(textarea, "   ");
    });
    const save = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        ".agent-composer__annotation-editor button",
      ),
    ].find((button) => button.textContent?.includes("app.action.save"));
    await act(async () => save?.click());
    await click_send(view);

    expect(on_send).toHaveBeenCalledWith({
      text: "",
      attachments: [{ kind: "response_annotation", selectedText: "旧回复", comment: "" }],
    });
  });

  it("混合附件按原索引编辑而不改写草稿顺序", async () => {
    const input_session = create_input_session();
    input_session.write_draft({
      text: "",
      attachments: [
        { kind: "response_annotation", selectedText: "被引用的旧回复", comment: "内部评论" },
        { kind: "image", webpBase64: "webp-a" },
      ],
    });

    const view = await render_composer({ input_session });
    expect(input_session.read_draft().attachments.map((attachment) => attachment.kind)).toEqual([
      "response_annotation",
      "image",
    ]);
    const annotation = view.querySelector<HTMLButtonElement>(
      'button[aria-label^="agent_page.annotation.title "]',
    );
    await act(async () => annotation?.click());
    const remove = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        ".agent-composer__annotation-editor button",
      ),
    ].find((button) => button.textContent?.includes("agent_page.annotation.remove"));
    if (remove === undefined) throw new Error("缺少批注删除动作");
    await act(async () => remove.click());
    expect(input_session.read_draft().attachments.map((attachment) => attachment.kind)).toEqual([
      "image",
    ]);
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
    expect(input_session.read_draft()).toEqual({ text: "", attachments: [] });
    expect(view.querySelector(".agent-attachment")).toBeNull();
  });

  it("运行态有内容时发送进入队列", async () => {
    const on_send = vi.fn();
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, on_send, on_stop });
    const editor = get_editor(view);
    await set_document(editor, "继续补充", 4);
    expect(editor.state.readOnly).toBe(false);
    expect(view.querySelector(".agent-composer__submit")?.getAttribute("aria-keyshortcuts")).toBe(
      "Enter",
    );
    await click_send(view);
    expect(on_send).toHaveBeenCalledWith({ text: "继续补充", attachments: [] });
    expect(on_stop).not.toHaveBeenCalled();
  });

  it("消息队列已满时禁用新增发送并显示容量提示", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ running: true, queue_full: true, on_send });
    await set_document(get_editor(view), "继续补充", 4);
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");
    expect(submit?.disabled).toBe(true);
    expect(submit?.getAttribute("aria-label")).toContain("agent_page.queue.full");

    await act(async () => submit?.click());
    expect(on_send).not.toHaveBeenCalled();

    await render_composer({ can_continue_queue: true, queue_full: true, on_send });
    await set_document(get_editor(view), "追加消息", 4);
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__submit")?.disabled).toBe(true);
  });

  it("运行态无内容时主按钮停止当前任务", async () => {
    const on_send = vi.fn();
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, on_send, on_stop });

    await click_send(view);

    expect(view.querySelector(".agent-composer__submit")?.hasAttribute("aria-keyshortcuts")).toBe(
      false,
    );
    expect(on_stop).toHaveBeenCalledOnce();
    expect(on_send).not.toHaveBeenCalled();
  });

  it("暂停队列有无草稿都使用继续动作", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ can_continue_queue: true, on_send });
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");
    expect(submit?.disabled).toBe(false);
    expect(submit?.getAttribute("aria-label")).toBe("agent_page.action.continue");
    await click_send(view);
    expect(on_send).toHaveBeenLastCalledWith({ text: "", attachments: [] });

    await set_document(get_editor(view), "追加消息", 4);
    expect(submit?.getAttribute("aria-label")).toBe("agent_page.action.continue");
    await click_send(view);
    expect(on_send).toHaveBeenLastCalledWith({ text: "追加消息", attachments: [] });
  });

  it("命令进行时保留稳定动作名称但不渲染鼠标提示", async () => {
    const view = await render_composer({ can_continue_queue: true, command: "continue" });
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");

    expect(submit?.getAttribute("aria-label")).toBe("agent_page.action.continue");
    expect(submit?.getAttribute("aria-busy")).toBe("true");
    expect(submit?.querySelector(".animate-spin")).not.toBeNull();
    expect(view.querySelector(".agent-composer__footer-end [role=tooltip]")).toBeNull();
  });

  it("apply 运行期间禁用停止", async () => {
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, stop_disabled: true, on_stop });
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");

    expect(submit?.disabled).toBe(true);
    expect(submit?.hasAttribute("aria-label")).toBe(true);
    await act(async () => submit?.click());
    expect(on_stop).not.toHaveBeenCalled();
  });

  it("禁用的底栏控件仍由非禁用外壳承接鼠标提示", async () => {
    const view = await render_composer({
      command: "send",
      approval_mode_disabled: true,
    });

    const image_button = view.querySelector<HTMLButtonElement>(".agent-composer__image-trigger");
    const trigger = image_button?.parentElement;
    expect(image_button?.disabled).toBe(true);
    expect(trigger).not.toBeNull();
    vi.useFakeTimers();
    try {
      await act(async () => {
        trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        trigger?.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
        );
        vi.runOnlyPendingTimers();
      });
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
        "agent_page.action.add_image",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("压缩期间允许有效草稿排队", async () => {
    const on_send = vi.fn();
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, compacting: true, on_send, on_stop });
    const editor = get_editor(view);
    await set_document(editor, "继续补充", 4);
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");
    expect(editor.state.readOnly).toBe(false);
    expect(submit?.disabled).toBe(false);
    expect(submit?.hasAttribute("aria-label")).toBe(true);
    await act(async () => submit?.click());
    expect(on_stop).not.toHaveBeenCalled();
    expect(on_send).toHaveBeenCalledWith({ text: "继续补充", attachments: [] });
  });

  it("所选模型没有可用思考档位时保留禁用的默认入口", async () => {
    const view = await render_composer({
      model_selection: {
        snapshot: {
          model_selection: { translation: "agent", agent: "agent" },
          models: [
            {
              id: "agent",
              type: "CUSTOM_OPENAI",
              name: "Unknown Model",
              agent_limits: { context_window: 256_000, max_output_tokens: 32_000 },
              thinking_level: "OFF",
              available_thinking_levels: [],
            },
          ],
        },
      },
    });

    const trigger = view.querySelector<HTMLButtonElement>(".agent-composer__thinking-trigger");
    expect(trigger?.disabled).toBe(true);
    expect(trigger?.textContent).toContain("app.model.thinking_level.default");
    expect(trigger?.parentElement?.tabIndex).toBe(0);
  });

  it("显示当前写入请求审批模式并在运行 apply 时禁用入口", async () => {
    const on_approval_mode_change = vi.fn();
    const view = await render_composer({
      approval_mode: "auto",
      approval_mode_disabled: true,
      on_approval_mode_change,
    });

    const trigger = view.querySelector<HTMLButtonElement>(".agent-composer__approval-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-label")?.trim()).not.toBe("");
    expect(trigger?.disabled).toBe(true);
    expect(on_approval_mode_change).not.toHaveBeenCalled();
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
        createElement(
          TooltipProvider,
          null,
          <AgentComposer
            ref={options.composer_ref}
            presentation={options.presentation}
            inline_role={options.inline_role}
            on_cancel_edit={options.on_cancel_edit}
            locked={options.locked}
            skills={options.skills ?? skills}
            instructions={options.instructions}
            running={options.running ?? false}
            stop_disabled={options.stop_disabled ?? false}
            compacting={options.compacting ?? false}
            unavailable_reason={options.unavailable_reason ?? null}
            command={options.command ?? null}
            can_continue_queue={options.can_continue_queue ?? false}
            queue_full={options.queue_full ?? false}
            can_reset={options.can_reset ?? true}
            context_tokens={options.context_tokens ?? null}
            approval_mode={options.approval_mode}
            approval_mode_disabled={options.approval_mode_disabled ?? false}
            model_selection={{
              snapshot: {
                model_selection: { translation: "preset", agent: "agent" },
                models: [
                  {
                    id: "agent",
                    type: "CUSTOM_OPENAI",
                    name: "Agent Model",
                    agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
                    thinking_level: "MEDIUM",
                    available_thinking_levels: ["LOW", "MEDIUM", "HIGH"],
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
            on_approval_mode_change={options.on_approval_mode_change}
            on_image_error={options.on_image_error ?? vi.fn()}
            on_stop={options.on_stop ?? vi.fn(async () => undefined)}
            on_reset={options.on_reset ?? vi.fn()}
          />,
        ),
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
  let draft: AgentMessageInput = { text: "", attachments: [] };
  const session: TestAgentInputSession = {
    revision: 0,
    read_draft: () => draft,
    write_draft: (next_draft) => {
      draft = next_draft;
    },
    read_history: () => history,
    replace_history: vi.fn(),
    accept_message: () => {
      draft = { text: "", attachments: [] };
      session.revision += 1;
    },
  };
  return session;
}

function image_attachments(...images: string[]): AgentMessageAttachment[] {
  return images.map((webpBase64) => ({ kind: "image", webpBase64 }));
}

function set_textarea_value(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
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

/** 分发编辑器按键并返回事件，以便验证快捷键是否接管默认行为。 */
async function dispatch_key(
  content: HTMLElement,
  key: string,
  shiftKey = false,
  isComposing = false,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "isComposing", { value: isComposing });
  await act(async () => {
    content.focus();
    content.dispatchEvent(event);
  });
  return event;
}
