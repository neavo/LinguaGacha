import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentResponseAnnotationSelection } from "./agent-response-annotation-selection";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AgentResponseAnnotationSelection", () => {
  let root: Root;
  let container: HTMLDivElement;
  const on_add = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    window.getSelection()?.removeAllRanges();
    container.remove();
    on_add.mockReset();
  });

  /** 复用挂载实例，验证禁用与恢复时的监听生命周期。 */
  async function render(
    children: ReactNode = (
      <article data-agent-annotation-message="true" tabIndex={-1}>
        <div>
          <p>第一段正文</p>
          <p>第二段正文</p>
        </div>
      </article>
    ),
    disabled = false,
  ): Promise<void> {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentResponseAnnotationSelection disabled={disabled} on_add={on_add}>
            {children}
          </AgentResponseAnnotationSelection>
        </TooltipProvider>,
      ),
    );
  }

  /** happy-dom 使用真实 Range，并显式发送浏览器的选区通知。 */
  function select(start: Node, end: Node = start, end_offset = 3): void {
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end_offset);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }
  /** 从 Portal 的实际挂载位置读取浮层。 */
  const toolbar = (): Element | null => document.querySelector('[role="toolbar"]');
  /** 获取用户进入批注编辑的操作。 */
  const button = (): HTMLButtonElement => document.querySelector('[role="toolbar"] button')!;
  /** 默认回复提供稳定的文字节点，供选区与替换场景使用。 */
  const text = (): Node => container.querySelector("p")!.firstChild!;
  /** 指针事件沿真实文档路径传播，覆盖容器外松手。 */
  const pointer = (target: EventTarget, type: string): void => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
  };
  /** 等待待执行的选区同步及其 React 提交。 */
  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }

  it.each(["之前", "之后"])("选区在松手%s更新，容器外结束拖选也能出现动作条", async (order) => {
    await render();
    await act(async () => pointer(container.querySelector("p")!, "pointerdown"));
    if (order === "之前") {
      select(text());
      await flush();
      expect(toolbar()).toBeNull();
    }
    await act(async () => pointer(document.body, "pointerup"));
    if (order === "之后") {
      await flush();
      expect(toolbar()).toBeNull();
      select(text());
    }
    await flush();
    expect(toolbar()).not.toBeNull();
    await act(async () => button().click());
    expect(document.querySelector("blockquote")?.textContent).toBe("第一段");
  });

  it("选区同步不抢焦点，Tab 进入批注后冻结引用并提交评论", async () => {
    await render();
    const message = container.querySelector<HTMLElement>("article")!;
    message.focus();
    select(text());
    await flush();
    expect(document.activeElement).toBe(message);
    select(text(), text(), 5);
    await flush();
    expect(document.activeElement).toBe(message);
    await act(async () =>
      message.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(button());
    await act(async () => button().click());
    const textarea = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "  请改写  ",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("p")!.textContent = "持续生成的新正文";
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    await flush();
    expect(document.querySelector("blockquote")?.textContent).toBe("第一段正文");
    await act(async () =>
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(on_add).toHaveBeenCalledWith({
      kind: "response_annotation",
      selectedText: "第一段正文",
      comment: "请改写",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(message);
  });

  it("父元素边界与同一消息的连续正文块可以批注", async () => {
    await render(
      <article data-agent-annotation-message="true">
        <div>
          <p>第一段</p>
        </div>
        <div>
          <p>第二段</p>
        </div>
      </article>,
    );
    const message = container.querySelector("article")!;
    select(message, message, 2);
    await flush();
    await act(async () => button().click());
    expect(document.querySelector("blockquote")?.textContent).toBe("第一段第二段");
  });

  it.each(["回复", "思考", "图表", "按钮"])("跨%s边界的选区被拒绝", async (kind) => {
    const middle =
      kind === "思考" ? (
        <div data-agent-annotation-exclude="true">思考</div>
      ) : kind === "图表" ? (
        <div data-streamdown="mermaid">图表</div>
      ) : kind === "按钮" ? (
        <button>操作</button>
      ) : null;
    await render(
      <>
        <article data-agent-annotation-message="true">
          <div>
            <p>第一段</p>
            {middle}
            {kind !== "回复" && <p>第二段</p>}
          </div>
        </article>
        {kind === "回复" && (
          <article data-agent-annotation-message="true">
            <div>
              <p>第二段</p>
            </div>
          </article>
        )}
      </>,
    );
    const paragraphs = container.querySelectorAll("p");
    select(paragraphs[0]!.firstChild!, paragraphs[1]!.firstChild!);
    await flush();
    expect(toolbar()).toBeNull();
  });

  it("重新选择更新引用，动作条聚焦后仍响应流式选区失效", async () => {
    await render();
    select(text());
    await flush();
    await act(async () => pointer(container.querySelector("p")!, "pointerdown"));
    expect(toolbar()).toBeNull();
    select(text(), text(), 5);
    await act(async () => pointer(document, "pointerup"));
    await flush();
    expect(toolbar()).not.toBeNull();
    await act(async () => {
      button().focus();
      container.querySelector("p")!.textContent = "替换的正文";
    });
    await flush();
    expect(toolbar()).toBeNull();
  });

  it.each(["Escape", "外部点击", "指针取消", "窗口失焦"])(
    "%s 关闭后待执行同步不会重开旧选区",
    async (kind) => {
      await render();
      select(text());
      await flush();
      document.dispatchEvent(new Event("selectionchange"));
      await act(async () => {
        if (kind === "Escape")
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else if (kind === "外部点击") pointer(document.body, "pointerdown");
        else if (kind === "指针取消") pointer(document, "pointercancel");
        else window.dispatchEvent(new Event("blur"));
      });
      await flush();
      expect(toolbar()).toBeNull();
      expect(window.getSelection()?.rangeCount).toBe(0);
    },
  );

  it("禁用时关闭批注并停止接收选区，恢复后可以再次选择", async () => {
    await render();
    select(text());
    await flush();
    await render(undefined, true);
    select(text());
    await flush();
    expect(toolbar()).toBeNull();
    await render();
    select(text());
    await flush();
    expect(toolbar()).not.toBeNull();
  });
});
