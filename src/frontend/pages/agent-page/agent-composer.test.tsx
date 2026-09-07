import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { AgentMessageInput } from "@shared/agent";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentComposer } from "./agent-composer";

type RenderComposerOptions = Partial<ComponentProps<typeof AgentComposer>>;
vi.mock("@frontend/app/session/translation-export/translation-export-context", () => ({
  useTranslationExport: () => ({ can_request_export: true, request_export: vi.fn() }),
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ locale: "zh-CN", t: (key: string) => key }),
}));

describe("AgentComposer", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let draft: AgentMessageInput = { text: "", attachments: [] };
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    draft = { text: "", attachments: [] };
  });
  it("运行中有内容发送，清空草稿后停止任务", async () => {
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
    await set_document(editor, "", 0);
    await click_send(view);
    expect(on_stop).toHaveBeenCalledOnce();
    expect(on_send).toHaveBeenCalledOnce();
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

  it("apply 运行期间禁用停止", async () => {
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ running: true, stop_disabled: true, on_stop });
    const submit = view.querySelector<HTMLButtonElement>(".agent-composer__submit");

    expect(submit?.disabled).toBe(true);
    await act(async () => submit?.click());
    expect(on_stop).not.toHaveBeenCalled();
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
    await act(async () => submit?.click());
    expect(on_stop).not.toHaveBeenCalled();
    expect(on_send).toHaveBeenCalledWith({ text: "继续补充", attachments: [] });
  });

  /** 复用草稿和挂载实例，观察任务状态变化对发送与停止的影响。 */
  async function render_composer(options: RenderComposerOptions = {}): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
    }
    root ??= createRoot(container);
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <AgentComposer
            skills={[]}
            running={false}
            stop_disabled={false}
            compacting={false}
            unavailable_reason={null}
            command={null}
            can_continue_queue={false}
            queue_full={false}
            can_reset={true}
            context={{ tokens: null, compactable: false, limits: null }}
            model_selection={{
              snapshot: {
                models: [],
                model_selection: { translation: "", agent: "", agent_batch_translation: null },
              },
              loading: false,
              updating: false,
              select_model: async () => {},
              update_thinking_level: async () => {},
            }}
            input_session={{
              revision: 0,
              read_draft: () => draft,
              write_draft: (next) => {
                draft = next;
              },
              read_history: () => [],
              replace_history: () => {},
            }}
            on_send={vi.fn()}
            on_stop={async () => {}}
            on_reset={vi.fn()}
            on_image_error={vi.fn()}
            {...options}
          />
        </TooltipProvider>,
      ),
    );
    return container;
  }
});

/** 取得真实编辑器实例以输入任务草稿。 */
function get_editor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) throw new Error("缺少 CodeMirror 编辑器");
  return editor;
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

/** 从可见主按钮触发当前任务动作。 */
async function click_send(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(".agent-composer__submit");
  if (button === null) throw new Error("缺少发送按钮");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}
