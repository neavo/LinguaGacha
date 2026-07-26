import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppPageDialog } from "./app-page-dialog";

vi.mock("@frontend/app/locale/locale-provider", () => ({
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

  function render_dialog(element: JSX.Element): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(element);
    });
  }

  it("未提供 footer 时渲染应用关闭动作", () => {
    const on_close = vi.fn();
    render_dialog(
      <AppPageDialog open title="设置" onClose={on_close}>
        正文
      </AppPageDialog>,
    );

    const close_button = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "app.action.close",
    );
    expect(close_button).toBeDefined();

    act(() => {
      close_button?.click();
    });
    expect(on_close).toHaveBeenCalledOnce();
  });

  it("blocked 模式阻止 Escape 关闭", () => {
    const on_close = vi.fn();
    render_dialog(
      <AppPageDialog open title="提交中" dismissBehavior="blocked" footer={null} onClose={on_close}>
        正文
      </AppPageDialog>,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        }),
      );
    });

    expect(on_close).not.toHaveBeenCalled();
    expect(document.body.querySelector("button")).toBeNull();
  });
});
