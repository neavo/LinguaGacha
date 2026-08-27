import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppActionDialog, AppConfirmDialog } from "./app-alert-dialog";

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

describe("应用模态窗", () => {
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
    vi.useRealTimers();
  });

  it("普通确认固定使用取消、确认和主题色", () => {
    const on_confirm = vi.fn();
    const on_close = vi.fn();
    render_dialog(
      <AppConfirmDialog
        open
        description="是否确认执行？"
        onConfirm={on_confirm}
        onClose={on_close}
      />,
    );

    expect(read_button("app.action.cancel")?.dataset.variant).toBe("outline");
    expect(read_button("app.action.confirm")?.dataset.variant).toBe("default");

    click_button("app.action.confirm");
    click_button("app.action.cancel");
    expect(on_confirm).toHaveBeenCalledTimes(1);
    expect(on_close).toHaveBeenCalledTimes(1);
  });

  it("动作模态窗把显式选择交回业务层", () => {
    const on_primary = vi.fn();
    const on_secondary = vi.fn();
    const on_dismiss = vi.fn();
    render_dialog(
      <AppActionDialog
        open
        description="请选择处理方式"
        primaryAction={{ label: "覆盖", onSelect: on_primary, destructive: true }}
        secondaryAction={{ label: "跳过", onSelect: on_secondary }}
        dismissAction={{ label: "取消", onSelect: on_dismiss }}
        onClose={vi.fn()}
      />,
    );

    expect(document.body.querySelector('[data-slot="alert-dialog-title"]')?.textContent).toBe(
      "app.action.confirm",
    );
    expect(read_button("覆盖")?.dataset.variant).toBe("destructive");
    click_button("覆盖");
    click_button("跳过");
    click_button("取消");
    expect(on_primary).toHaveBeenCalledTimes(1);
    expect(on_secondary).toHaveBeenCalledTimes(1);
    expect(on_dismiss).toHaveBeenCalledTimes(1);
  });

  it("提交中锁定关闭与动作，并支持无图标进度文案", () => {
    const on_close = vi.fn();
    render_dialog(
      <AppActionDialog
        open
        description="正在下载"
        submitting
        submittingLabel="50%"
        submittingIcon={false}
        primaryAction={{ label: "确认", onSelect: vi.fn() }}
        onClose={on_close}
      />,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
      );
    });

    expect(on_close).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="spinner"]')).toBeNull();
    expect(read_button("50%")?.disabled).toBe(true);
    expect(read_button("app.action.cancel")?.disabled).toBe(true);
  });

  it("延迟确认显示秒数并在三秒后开放提交", () => {
    vi.useFakeTimers();
    const on_confirm = vi.fn();

    render_dialog(
      <AppConfirmDialog
        open
        description="是否确认重置？"
        confirmDelay
        onConfirm={on_confirm}
        onClose={vi.fn()}
      />,
    );

    expect(read_button("3s")?.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(read_button("2s")?.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(read_button("1s")?.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(read_button("app.action.confirm")?.disabled).toBe(false);

    click_button("app.action.confirm");
    expect(on_confirm).toHaveBeenCalledTimes(1);
  });

  function render_dialog(element: JSX.Element): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(element);
    });
  }

  function read_button(text: string): HTMLButtonElement | null {
    return (
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent === text,
      ) ?? null
    );
  }

  function click_button(text: string): void {
    act(() => {
      read_button(text)?.click();
    });
  }
});
