import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import { AppAlertDialog } from "./app-alert-dialog";

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/shadcn/spinner", () => {
  return {
    Spinner: () => <span data-testid="spinner" />,
  };
});

describe("AppAlertDialog", () => {
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

  it("默认确认和取消文案来自应用 i18n", () => {
    const on_confirm = vi.fn();
    const on_close = vi.fn();

    render_dialog(
      <AppAlertDialog
        open
        description="确认删除项目？"
        onConfirm={on_confirm}
        onClose={on_close}
      />,
    );

    expect(document.body.querySelector('[data-slot="alert-dialog-title"]')?.textContent).toBe(
      "app.action.confirm",
    );
    expect(document.body.querySelector('[data-slot="alert-dialog-description"]')?.textContent).toBe(
      "确认删除项目？",
    );
    expect(read_buttons_text("alert-dialog-cancel")).toEqual(["app.action.cancel"]);
    expect(read_buttons_text("alert-dialog-action")).toContain("app.action.confirm");

    click_slot_button("alert-dialog-cancel");

    expect(on_close).toHaveBeenCalledTimes(1);
  });

  it("提交中会锁定关闭和按钮，并按配置隐藏加载图标", () => {
    const on_close = vi.fn();

    render_dialog(
      <AppAlertDialog
        open
        description="正在下载更新"
        submitting
        submittingIcon={false}
        submittingLabel="45.00%"
        onConfirm={vi.fn()}
        onClose={on_close}
      />,
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
    expect(document.body.querySelector('[data-testid="spinner"]')).toBeNull();
    expect(read_buttons_text("alert-dialog-action")).toContain("45.00%");
    expect(read_first_button("alert-dialog-action")?.disabled).toBe(true);
    expect(read_first_button("alert-dialog-cancel")?.disabled).toBe(true);
  });

  it("确认、取消和次要动作都通过公开回调返回业务层", () => {
    const on_confirm = vi.fn();
    const on_cancel = vi.fn();
    const on_secondary = vi.fn();
    const on_close = vi.fn();

    render_dialog(
      <AppAlertDialog
        open
        description="准备更新"
        confirmLabel="更新"
        cancelLabel="稍后"
        secondaryLabel="查看发布页"
        onConfirm={on_confirm}
        onCancel={on_cancel}
        onSecondary={on_secondary}
        onClose={on_close}
      />,
    );

    click_button_by_text("更新");
    click_button_by_text("稍后");
    click_button_by_text("查看发布页");

    expect(on_confirm).toHaveBeenCalledTimes(1);
    expect(on_cancel).toHaveBeenCalledTimes(1);
    expect(on_secondary).toHaveBeenCalledTimes(1);
    expect(on_close).not.toHaveBeenCalled();
  });

  function render_dialog(element: JSX.Element): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(element);
    });
  }

  function read_buttons_text(slot: string): string[] {
    return Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(`[data-slot="${slot}"]`),
    ).map((button) => button.textContent ?? "");
  }

  function read_first_button(slot: string): HTMLButtonElement | null {
    return document.body.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`);
  }

  function click_slot_button(slot: string): void {
    act(() => {
      read_first_button(slot)?.click();
    });
  }

  function click_button_by_text(text: string): void {
    const button =
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent === text,
      ) ?? null;
    act(() => {
      button?.click();
    });
  }
});
