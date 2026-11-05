import { type JSX, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppPageDialog } from "./app-page-dialog";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("AppPageDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载弹窗，由可见按钮与按键观察组件行为。 */
  function render_dialog(element: JSX.Element): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(element);
    });
  }

  /** 按去掉键帽后的按钮文案定位按钮。 */
  function read_button(label: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.replace(button.querySelector("kbd")?.textContent ?? "", "") === label,
    );
  }

  /** 在 React 更新边界内派发冒泡的按键事件。 */
  function press(target: EventTarget, init: KeyboardEventInit): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  }

  it("无主操作时渲染带 Esc 键帽的关闭动作", () => {
    const on_close = vi.fn();
    render_dialog(
      <AppPageDialog open title="设置" onClose={on_close}>
        正文
      </AppPageDialog>,
    );

    const close_button = read_button("app.action.close");
    expect(close_button?.getAttribute("aria-keyshortcuts")).toBe("Escape");
    act(() => {
      close_button?.click();
    });
    expect(on_close).toHaveBeenCalledOnce();
  });

  it.each([
    ["submit", "input", { key: "Enter" }],
    ["save", "textarea", { key: "s", ctrlKey: true }],
  ] as const)("%s 主操作响应弹窗内的对应按键", (shortcut, Field, init) => {
    const on_select = vi.fn();
    render_dialog(
      <AppPageDialog
        open
        title="编辑"
        primaryAction={{ label: "保存", shortcut, onSelect: on_select }}
        onClose={vi.fn()}
      >
        <Field aria-label="内容" />
      </AppPageDialog>,
    );

    press(document.body.querySelector('[aria-label="内容"]')!, init);
    expect(on_select).toHaveBeenCalledOnce();
  });

  it.each([false, true])("提交状态 %s 保留绑定，锁定后恢复主操作", (submitting) => {
    const on_close = vi.fn();
    const on_select = vi.fn();
    const dialog = (disabled: boolean) => (
      <AppPageDialog
        open
        title="编辑"
        submitting={submitting && disabled}
        primaryAction={{ label: "保存", shortcut: "submit", disabled, onSelect: on_select }}
        onClose={on_close}
      >
        <input aria-label="名称" />
      </AppPageDialog>
    );
    render_dialog(dialog(true));

    if (submitting) press(document, { key: "Escape", code: "Escape" });
    const save = read_button("保存")!;
    const cancel = read_button("app.action.cancel")!;
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(save.querySelector("kbd")?.getAttribute("aria-hidden")).toBe("true");
    expect(cancel.getAttribute("aria-keyshortcuts")).toBe("Escape");
    expect(cancel.querySelector("kbd")?.textContent).toBe("Esc");
    act(() => {
      save.click();
      if (submitting) cancel.click();
    });
    press(document.body.querySelector('input[aria-label="名称"]')!, { key: "Enter" });
    expect(on_close).not.toHaveBeenCalled();
    expect(on_select).not.toHaveBeenCalled();
    act(() => root?.render(dialog(false)));
    expect(read_button("保存")).toBe(save);
    expect(save.disabled).toBe(false);
    press(document.body.querySelector('input[aria-label="名称"]')!, { key: "Enter" });
    expect(on_select).toHaveBeenCalledOnce();
  });

  it("escape-only 模式允许 Escape 关闭", () => {
    const on_close = vi.fn();
    render_dialog(
      <AppPageDialog open title="编辑" dismissBehavior="escape-only" onClose={on_close}>
        正文
      </AppPageDialog>,
    );

    press(document, { key: "Escape", code: "Escape" });
    expect(on_close).toHaveBeenCalledOnce();
  });
});
