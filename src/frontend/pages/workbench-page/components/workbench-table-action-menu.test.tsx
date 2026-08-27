import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkbenchTableActionMenu,
  WorkbenchTableContextMenuContent,
} from "./workbench-table-action-menu";

const { dropdown_open_change_ref } = vi.hoisted(() => ({
  dropdown_open_change_ref: {
    current: undefined as ((open: boolean) => void) | undefined,
  },
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenu: (props: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => {
    dropdown_open_change_ref.current = props.onOpenChange;
    return <div>{props.children}</div>;
  },
  AppDropdownMenuTrigger: (props: {
    children?: ReactElement<{
      "aria-label"?: string;
      children?: ReactNode;
      disabled?: boolean;
    }>;
    render?: ReactElement<{
      "aria-label"?: string;
      children?: ReactNode;
      disabled?: boolean;
    }>;
  }) => {
    const trigger = props.render ?? props.children;
    if (trigger === undefined) return null;
    return (
      <button
        type="button"
        aria-label={trigger.props["aria-label"]}
        disabled={trigger.props.disabled}
        onClick={() => dropdown_open_change_ref.current?.(true)}
      >
        {trigger.props.children}
      </button>
    );
  },
  AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock("@frontend/widgets/app-context-menu", () => ({
  AppContextMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppContextMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppContextMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

describe("WorkbenchTableActionMenu", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    dropdown_open_change_ref.current = undefined;
  });

  async function render_menu(element: ReactNode): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(element));
  }

  function find_reset_button(): HTMLButtonElement {
    const button = [...(container?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent?.trim() === "workbench_page.action.reset",
    );
    if (button === undefined) {
      throw new Error("缺少重置动作");
    }
    return button;
  }

  it("下拉菜单用专用名称触发准备与重置，并继承禁用态", async () => {
    const on_prepare_open = vi.fn();
    const on_reset = vi.fn();
    await render_menu(
      <WorkbenchTableActionMenu
        disabled={false}
        on_prepare_open={on_prepare_open}
        on_reset={on_reset}
      />,
    );

    const trigger = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="workbench_page.table.actions"]',
    );
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    expect(trigger?.disabled).toBe(false);

    await act(async () => {
      trigger?.click();
      find_reset_button().click();
    });
    expect(on_prepare_open).toHaveBeenCalledOnce();
    expect(on_reset).toHaveBeenCalledOnce();

    await render_menu(
      <WorkbenchTableActionMenu
        disabled={true}
        on_prepare_open={on_prepare_open}
        on_reset={on_reset}
      />,
    );
    expect(
      container?.querySelector<HTMLButtonElement>(
        'button[aria-label="workbench_page.table.actions"]',
      )?.disabled,
    ).toBe(true);
    expect(find_reset_button().disabled).toBe(true);
  });

  it("右键菜单导出复用重置动作与禁用态", async () => {
    const on_reset = vi.fn();
    await render_menu(<WorkbenchTableContextMenuContent disabled={false} on_reset={on_reset} />);

    await act(async () => find_reset_button().click());
    expect(on_reset).toHaveBeenCalledOnce();

    await render_menu(<WorkbenchTableContextMenuContent disabled={true} on_reset={on_reset} />);
    expect(find_reset_button().disabled).toBe(true);
  });
});
