import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import { AppAlertDialog } from "./app-alert-dialog";

type DialogMockProps = {
  children: ReactNode;
  disabled?: boolean;
  onClick?: (event: { preventDefault: () => void }) => void;
  onOpenChange?: (open: boolean) => void;
  onEscapeKeyDown?: (event: { preventDefault: () => void }) => void;
};

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

vi.mock("@frontend/shadcn/alert-dialog", () => {
  const click_with_prevent_default = (handler?: DialogMockProps["onClick"]) => {
    handler?.({ preventDefault: vi.fn() });
  };

  return {
    AlertDialog: (props: DialogMockProps & { open: boolean }) => (
      <div data-testid="dialog-root" data-open={String(props.open)}>
        <button
          data-testid="dialog-close-signal"
          onClick={() => {
            props.onOpenChange?.(false);
          }}
        >
          close
        </button>
        {props.children}
      </div>
    ),
    AlertDialogAction: (props: DialogMockProps) => (
      <button
        data-testid="dialog-action"
        disabled={props.disabled}
        onClick={() => {
          click_with_prevent_default(props.onClick);
        }}
      >
        {props.children}
      </button>
    ),
    AlertDialogCancel: (props: DialogMockProps) => (
      <button
        data-testid="dialog-cancel"
        disabled={props.disabled}
        onClick={() => {
          click_with_prevent_default(props.onClick);
        }}
      >
        {props.children}
      </button>
    ),
    AlertDialogContent: (props: DialogMockProps) => (
      <section data-testid="dialog-content">
        <button
          data-testid="dialog-escape"
          onClick={() => {
            props.onEscapeKeyDown?.({ preventDefault: vi.fn() });
          }}
        >
          escape
        </button>
        {props.children}
      </section>
    ),
    AlertDialogDescription: (props: DialogMockProps) => (
      <p data-testid="dialog-description">{props.children}</p>
    ),
    AlertDialogFooter: (props: DialogMockProps) => <footer>{props.children}</footer>,
    AlertDialogHeader: (props: DialogMockProps) => <header>{props.children}</header>,
    AlertDialogTitle: (props: DialogMockProps) => <h2>{props.children}</h2>,
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
    vi.clearAllMocks();
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

    expect(container?.querySelector("h2")?.textContent).toBe("app.action.confirm");
    expect(container?.querySelector('[data-testid="dialog-description"]')?.textContent).toBe(
      "确认删除项目？",
    );
    expect(read_buttons_text("dialog-cancel")).toEqual(["app.action.cancel"]);
    expect(read_buttons_text("dialog-action")).toContain("app.action.confirm");
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

    click_test_button("dialog-close-signal");
    click_test_button("dialog-escape");

    expect(on_close).not.toHaveBeenCalled();
    expect(container?.querySelector('[data-testid="spinner"]')).toBeNull();
    expect(read_buttons_text("dialog-action")).toContain("45.00%");
    expect(read_first_button("dialog-action")?.disabled).toBe(true);
    expect(read_first_button("dialog-cancel")?.disabled).toBe(true);
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
    click_test_button("dialog-close-signal");

    expect(on_confirm).toHaveBeenCalledTimes(1);
    expect(on_cancel).toHaveBeenCalledTimes(1);
    expect(on_secondary).toHaveBeenCalledTimes(1);
    expect(on_close).toHaveBeenCalledTimes(1);
  });

  /**
   * 挂载确认框组件，保持每个用例只描述自身业务动作。
   */
  function render_dialog(element: JSX.Element): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(element);
    });
  }

  /**
   * 读取一类测试按钮的文本快照。
   */
  function read_buttons_text(test_id: string): string[] {
    return Array.from(
      container?.querySelectorAll<HTMLButtonElement>(`[data-testid="${test_id}"]`) ?? [],
    ).map((button) => button.textContent ?? "");
  }

  /**
   * 读取一类测试按钮中的第一个按钮。
   */
  function read_first_button(test_id: string): HTMLButtonElement | null {
    return container?.querySelector<HTMLButtonElement>(`[data-testid="${test_id}"]`) ?? null;
  }

  /**
   * 按测试 id 点击第一个匹配按钮。
   */
  function click_test_button(test_id: string): void {
    act(() => {
      read_first_button(test_id)?.click();
    });
  }

  /**
   * 按按钮文本点击匹配按钮，模拟用户选择具体动作。
   */
  function click_button_by_text(text: string): void {
    const button =
      Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (candidate) => candidate.textContent === text,
      ) ?? null;
    act(() => {
      button?.click();
    });
  }
});
