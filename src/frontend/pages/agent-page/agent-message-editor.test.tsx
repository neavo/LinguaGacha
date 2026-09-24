import type { AgentFileCandidate } from "@shared/agent-reference";
import { AgentInputDraft } from "@frontend/app/session/agent/agent-input-draft";
import { uploaded_file } from "../../../test/agent-upload-fixture";
import { act, createRef, type ComponentProps, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteCharBackward } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type AgentMessageAttachment } from "@shared/agent";
import type { AgentInputSession } from "@frontend/app/session/agent/agent-session-context";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

import { AgentMessageEditor, type AgentMessageEditorHandle } from "./agent-message-editor";

type RenderEditorOptions = Partial<
  Pick<
    ComponentProps<typeof AgentMessageEditor>,
    | "read_only"
    | "presentation"
    | "role"
    | "on_cancel"
    | "skills"
    | "instructions"
    | "input_session"
    | "on_submit"
  >
> & { editor_ref?: RefObject<AgentMessageEditorHandle | null> };

type TestAgentInputSession = AgentInputSession & { accept_message: () => void };

const mention_files = vi.hoisted(() => ({ files: [] as AgentFileCandidate[] }));
vi.mock("./use-agent-mention-files", () => ({
  useAgentMentionFiles: () => ({ files: mention_files.files, status: "ready" }),
}));
const image_mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_blob: async () => new Blob([], { type: "image/png" }),
  api_file_url: (path: string) => `http://localhost${path}`,
  api_upload: image_mocks.upload,
}));
vi.mock("@frontend/app/appearance/appearance-context", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
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
      "ja-JP": "Glossar prüfen",
      "ko-KR": "Glossar prüfen",
    },
  },
  {
    name: "corpus-search",
    displayDescriptions: {
      "zh-CN": "检索语料",
      "en-US": "Search corpus",
      "de-DE": "Korpus durchsuchen",
      "ja-JP": "Korpus durchsuchen",
      "ko-KR": "Korpus durchsuchen",
    },
  },
];

describe("AgentMessageEditor", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let default_input_session: TestAgentInputSession | null = null;

  beforeEach(() => {
    mention_files.files = [];
    image_mocks.upload.mockImplementation(async (_path: string, file: File) =>
      uploaded_file(`webp-${file.name}`),
    );
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    default_input_session = null;
    image_mocks.upload.mockClear();
  });

  it("选择技能插入 marker，选择压缩指令则移除筛选文本并立即执行", async () => {
    const on_submit = vi.fn();
    const on_compact = vi.fn();
    const view = await render_editor({
      on_submit,
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
    expect(editor.state.doc.toString()).toBe('前 @skill("glossary-audit") ');
    expect(view.querySelector(".agent-mention-token > span")?.textContent).toBe(
      '@skill("glossary-audit")',
    );

    await set_document(editor, "前 @compact 后", 10);
    await dispatch_key(content, "Enter");
    expect(editor.state.doc.toString()).toBe("前  后");
    expect(on_compact).toHaveBeenCalledOnce();
    expect(on_submit).not.toHaveBeenCalled();
  });

  it("打开中的 mention 菜单随技能集合更新并保留草稿", async () => {
    const view = await render_editor();
    const editor = get_editor(view);
    await set_document(editor, "草稿 @", 4);
    expect(
      view.querySelectorAll('[aria-labelledby="agent-mention-skills-label"] [role="option"]'),
    ).toHaveLength(2);
    await render_editor({ skills: skills.slice(1) });
    const options = view.querySelectorAll(
      '[aria-labelledby="agent-mention-skills-label"] [role="option"]',
    );
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("corpus-search");
    expect(editor.state.doc.toString()).toBe("草稿 @");
  });

  it("禁用的压缩指令保持筛选文本且不可触发", async () => {
    const on_compact = vi.fn();
    const view = await render_editor({
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
      const view = await render_editor({
        skills: Array.from({ length: 24 }, (_, index) => ({
          name: `skill-${index.toString()}`,
          displayDescriptions: {
            "zh-CN": `角色能力 ${index.toString()}`,
            "en-US": "",
            "de-DE": "",
            "ja-JP": "",
            "ko-KR": "",
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
    const view = await render_editor();
    const editor = get_editor(view);
    const marker = '@skill("glossary-audit")';
    await set_document(editor, marker, marker.length);

    expect(view.querySelector(".agent-mention-token > span")?.textContent).toBe(marker);
    expect(editor.state.doc.toString()).toBe(marker);
    await act(async () => expect(deleteCharBackward(editor)).toBe(true));
    expect(editor.state.doc.toString()).toBe("");
  });

  it("零结果保持菜单空态，方向键不访问非法索引，Enter 仍发送正文", async () => {
    const on_submit = vi.fn();
    const view = await render_editor({ on_submit });
    const editor = get_editor(view);
    await set_document(editor, "@missing", 8);
    const menu = await wait_for_element(view, '[role="listbox"]');
    expect(menu.querySelector('[role="option"]')).toBeNull();
    expect(editor.contentDOM.hasAttribute("aria-activedescendant")).toBe(false);
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("@missing");
    await dispatch_key(editor.contentDOM, "Enter");
    expect(on_submit).toHaveBeenCalledWith({ text: "@missing", attachments: [] });
  });

  it("Escape 关闭当前菜单，查询变化后重新打开", async () => {
    const view = await render_editor();
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
    const on_submit = vi.fn();
    const view = await render_editor({ on_submit });
    const editor = get_editor(view);
    await set_document(editor, "正文", 2);
    await dispatch_key(editor.contentDOM, "Enter", true);
    expect(editor.state.doc.toString()).toBe("正文\n");

    await set_document(editor, "@glo", 4);
    await dispatch_key(editor.contentDOM, "Enter", false, true);
    expect(editor.state.doc.toString()).toBe("@glo");
    expect(on_submit).not.toHaveBeenCalled();
  });

  it("用纯文本历史双向浏览并恢复当前草稿", async () => {
    const input_session = create_input_session(["第一条", '检查 @skill("glossary-audit") 完成']);
    const view = await render_editor({ input_session });
    const editor = get_editor(view);
    await set_document(editor, "当前草稿", 4);
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe('检查 @skill("glossary-audit") 完成');
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("第一条");
    await dispatch_key(editor.contentDOM, "ArrowDown");
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("当前草稿");
  });

  it("历史导航只从视觉首行启动，并在用户编辑后退出", async () => {
    const input_session = create_input_session(["历史消息"]);
    const view = await render_editor({ input_session });
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
    const editor_ref = createRef<AgentMessageEditorHandle>();
    const on_submit = vi.fn();
    const view = await render_editor({ editor_ref, input_session, on_submit });
    await act(async () => editor_ref.current?.write_draft('  检查 @skill("glossary-audit")  '));
    await click_send(view);
    expect(on_submit).toHaveBeenCalledWith({
      text: '检查 @skill("glossary-audit")',
      attachments: [],
    });
    input_session.accept_message();
    await render_editor({ editor_ref, input_session, on_submit });
    expect(get_editor(view).state.doc.toString()).toBe("");
  });

  it("文件选择后允许发送纯图片并从预览删除", async () => {
    const on_submit = vi.fn();
    const view = await render_editor({ on_submit });
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
    expect(on_submit).toHaveBeenCalledWith({
      text: "",
      attachments: image_attachments("webp-a.png"),
    });

    const remove = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === "app.action.delete",
    );
    await act(async () => remove?.click());
    expect(view.querySelectorAll(".agent-attachment")).toHaveLength(0);
  });

  it("拖入与粘贴图片均按顺序追加到草稿", async () => {
    const input_session = create_input_session();
    const view = await render_editor({ input_session });
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

    expect(input_session.draft.read()).toEqual({
      text: "",
      attachments: image_attachments("webp-drop.webp", "webp-paste.png"),
    });
    expect(view.querySelectorAll(".agent-attachment")).toHaveLength(2);
  });

  it.each([undefined, "inline"] as const)(
    "正文拖入文本文件只上传到所属草稿，展示模式 %s",
    async (presentation) => {
      const input_session = create_input_session();
      const view = await render_editor({ input_session, presentation });
      const editor = get_editor(view);
      await set_document(editor, "原有正文", 2);
      const selection = editor.state.selection.toJSON();
      const read_text = vi
        .spyOn(FileReader.prototype, "readAsText")
        .mockImplementation(() => undefined);
      const outer_drop = vi.fn();
      view.addEventListener("drop", outer_drop);
      try {
        const file = new File(["不能插入的文件内容"], "notes.txt", { type: "text/plain" });
        const enter = new DragEvent("dragenter", { bubbles: true, cancelable: true });
        Object.defineProperty(enter, "dataTransfer", { value: { types: ["Files"] } });
        await act(async () => editor.contentDOM.dispatchEvent(enter));
        expect(view.querySelector('[data-active="true"]')).not.toBeNull();
        const drop = new DragEvent("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [file] } });
        await act(async () => editor.contentDOM.dispatchEvent(drop));
        expect(read_text).not.toHaveBeenCalled();
        expect(editor.state.doc.toString()).toBe("原有正文");
        expect(editor.state.selection.toJSON()).toEqual(selection);
        expect(input_session.draft.read().attachments).toEqual([uploaded_file("webp-notes.txt")]);
        expect(image_mocks.upload).toHaveBeenCalledOnce();
        expect(outer_drop).not.toHaveBeenCalled();
        expect(view.querySelector('[data-active="true"]')).toBeNull();
      } finally {
        read_text.mockRestore();
        view.removeEventListener("drop", outer_drop);
      }
    },
  );

  it("正文文件拖放读取最新权限，助手编辑也不读取文件文本", async () => {
    const input_session = create_input_session();
    const view = await render_editor({ input_session });
    const read_text = vi
      .spyOn(FileReader.prototype, "readAsText")
      .mockImplementation(() => undefined);
    try {
      for (const options of [{ read_only: true }, { role: "assistant" as const }]) {
        await render_editor({ input_session, ...options });
        const drop = new DragEvent("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(drop, "dataTransfer", {
          value: { types: ["Files"], files: [new File(["text"], "notes.txt")] },
        });
        await act(async () => get_editor(view).contentDOM.dispatchEvent(drop));
        expect(drop.defaultPrevented).toBe(true);
      }
      expect(read_text).not.toHaveBeenCalled();
      expect(image_mocks.upload).not.toHaveBeenCalled();
      expect(input_session.draft.read().attachments).toEqual([]);
    } finally {
      read_text.mockRestore();
    }
  });

  it("新增批注在修改后随完整消息提交", async () => {
    const editor_ref = createRef<AgentMessageEditorHandle>();
    const input_session = create_input_session();
    const on_submit = vi.fn();
    const view = await render_editor({ editor_ref, input_session, on_submit });

    await act(async () =>
      editor_ref.current?.add_response_annotation({
        kind: "response_annotation",
        selectedText: "旧回复",
        comment: "原评论",
      }),
    );
    expect(input_session.draft.read().attachments).toEqual([
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

    expect(on_submit).toHaveBeenCalledWith({
      text: "",
      attachments: [{ kind: "response_annotation", selectedText: "旧回复", comment: "" }],
    });
  });

  it("混合附件按原索引编辑而不改写草稿顺序", async () => {
    const input_session = create_input_session();
    input_session.draft.write({
      text: "",
      attachments: [
        { kind: "response_annotation", selectedText: "被引用的旧回复", comment: "内部评论" },
        uploaded_file("webp-a"),
      ],
    });

    const view = await render_editor({ input_session });
    expect(input_session.draft.read().attachments.map((attachment) => attachment.kind)).toEqual([
      "response_annotation",
      "file",
    ]);
    const annotation = view.querySelector<HTMLButtonElement>(
      'button[aria-label^="agent_page.annotation.title "]',
    );
    await act(async () => annotation?.click());
    const remove = [
      ...document.body.querySelectorAll<HTMLButtonElement>(".agent-attachment button"),
    ].find((button) => button.getAttribute("aria-label") === "app.action.delete");
    if (remove === undefined) throw new Error("缺少批注删除动作");
    await act(async () => remove.click());
    expect(input_session.draft.read().attachments.map((attachment) => attachment.kind)).toEqual([
      "file",
    ]);
  });

  it("文件选择返回时遵循当前编辑锁", async () => {
    const input_session = create_input_session();
    const view = await render_editor({ input_session });
    await render_editor({ input_session, read_only: true });
    const input = view.querySelector<HTMLInputElement>(".agent-composer__file-input")!;
    Object.defineProperty(input, "files", {
      value: [new File([], "locked.png", { type: "image/png" })],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(input_session.draft.read().attachments).toEqual([]);
    expect(image_mocks.upload).not.toHaveBeenCalled();
  });

  it("上传失败保留文件卡片，重试后可以发送", async () => {
    image_mocks.upload.mockRejectedValueOnce(new Error("offline"));
    const input_session = create_input_session();
    const on_submit = vi.fn();
    const view = await render_editor({ input_session, on_submit });
    await act(async () => input_session.draft.append([new File(["text"], "notes.txt")]));
    expect(view.querySelector(".agent-attachment__body")?.getAttribute("aria-label")).toContain(
      "agent_page.upload.failed",
    );
    await click_send(view);
    expect(on_submit).not.toHaveBeenCalled();
    const retry = [...view.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.includes("agent_page.upload.retry"),
    );
    await act(async () => retry?.click());
    await click_send(view);
    expect(on_submit).toHaveBeenCalledWith({
      text: "",
      attachments: [uploaded_file("webp-notes.txt")],
    });
  });

  it("禁用的底栏控件仍由非禁用外壳承接鼠标提示", async () => {
    const view = await render_editor({
      read_only: true,
    });

    const image_button = view.querySelector<HTMLButtonElement>(".agent-composer__file-trigger");
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
        "agent_page.action.add_file",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("原位编辑先关闭候选，再取消；保存期间交还 Escape", async () => {
    const on_cancel = vi.fn();
    const view = await render_editor({ presentation: "inline", on_cancel });
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await wait_for_element(view, '[role="listbox"]');
    await dispatch_key(editor.contentDOM, "Escape");
    expect(on_cancel).not.toHaveBeenCalled();
    await dispatch_key(editor.contentDOM, "Escape");
    expect(on_cancel).toHaveBeenCalledOnce();
    await render_editor({ presentation: "inline", on_cancel, read_only: true });
    expect((await dispatch_key(editor.contentDOM, "Escape")).defaultPrevented).toBe(false);
    expect(on_cancel).toHaveBeenCalledOnce();
  });

  it("文件候选展示完整路径，并只把引用写入正文", async () => {
    mention_files.files = [
      { kind: "workspace", path: "资料/角色设定.xlsx", count: 320, unit: "items" },
      { kind: "upload", path: "uploads/角色设定.xlsx", size: 128 },
    ];
    const input = create_input_session();
    const view = await render_editor({ input_session: input });
    const editor = get_editor(view);
    await set_document(editor, "@角色", 3);
    await wait_for_element(view, 'button[data-kind="file"]');
    const options = [...view.querySelectorAll<HTMLButtonElement>('button[data-kind="file"]')];
    expect(options.map((option) => option.querySelector("strong")?.textContent)).toEqual([
      "资料/角色设定.xlsx",
      "uploads/角色设定.xlsx",
    ]);
    await act(async () => options[0]!.click());
    expect(editor.state.doc.toString()).toBe('@workspace_file("资料/角色设定.xlsx") ');
    expect(input.draft.read().attachments).toEqual([]);
  });

  it.each(["strong", "small"])("候选 %s 列使用应用提示显示自身全文", async (column) => {
    mention_files.files = [
      { kind: "workspace", path: "资料/很长的目录/角色设定.xlsx", count: 320, unit: "items" },
    ];
    const view = await render_editor();
    const editor = get_editor(view);
    await set_document(editor, "@角色", 3);
    await wait_for_element(view, 'button[data-kind="file"]');
    const row = view.querySelector('button[data-kind="file"]')!;
    const trigger = row.querySelector<HTMLElement>(column)!;
    expect(row.querySelectorAll("button")).toHaveLength(0);
    expect(trigger.getAttribute("title")).toBeNull();
    vi.useFakeTimers();
    try {
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        trigger.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
        );
        vi.runOnlyPendingTimers();
      });
      const tooltip = document.body.querySelector('[role="tooltip"]');
      expect(tooltip?.textContent).toBe(trigger.textContent);
    } finally {
      vi.useRealTimers();
    }
  });

  /** 同一编辑实例消费测试草稿，业务按钮仅承接发送当前消息。 */
  async function render_editor(options: RenderEditorOptions = {}): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
    }
    root ??= createRoot(container);
    default_input_session ??= create_input_session();
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <AgentMessageEditor
            ref={options.editor_ref}
            presentation={options.presentation}
            role={options.role}
            read_only={options.read_only ?? false}
            skills={options.skills ?? skills}
            instructions={options.instructions}
            input_session={options.input_session ?? default_input_session!}
            on_submit={options.on_submit ?? vi.fn()}
            on_cancel={options.on_cancel}

            render_actions={({ has_content, uploads_pending }) => {
              const can_submit = !options.read_only && has_content && !uploads_pending;
              return {
                can_submit,
                submit: (
                  <button type="submit" className="agent-composer__submit" disabled={!can_submit}>
                    发送
                  </button>
                ),
              };
            }}
          />
        </TooltipProvider>,
      ),
    );
    return container;
  }
});

/** 通过挂载的 DOM 取得真实编辑器实例。 */
function get_editor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) throw new Error("缺少 CodeMirror 编辑器");
  return editor;
}

/** 组件测试只模拟草稿与历史读取契约，持久化责任由 Provider 和历史 helper 单独验证。 */
function create_input_session(history: readonly string[] = []): TestAgentInputSession {
  const draft = new AgentInputDraft();
  const session: TestAgentInputSession = {
    revision: 0,
    draft,
    read_history: () => history,
    replace_history: vi.fn(),
    accept_message: () => {
      draft.clear();
      session.revision += 1;
    },
  };
  return session;
}

/** 按协议保留图片附件顺序。 */
function image_attachments(...images: string[]): AgentMessageAttachment[] {
  return images.map((id) => uploaded_file(id));
}

/** 使用原生输入事件更新批注，经过 React 表单边界。 */
function set_textarea_value(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 一次事务同步正文和光标。 */
async function set_document(editor: EditorView, text: string, head: number): Promise<void> {
  await act(async () => {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      selection: EditorSelection.cursor(head),
    });
  });
}

/** 提交消费方提供的发送动作。 */
async function click_send(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(".agent-composer__submit");
  if (button === null) throw new Error("缺少发送按钮");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

/** 等待编辑器更新投影到 React 界面。 */
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
