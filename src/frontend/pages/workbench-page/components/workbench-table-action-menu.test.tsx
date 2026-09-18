import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchTableActionMenu } from "./workbench-table-action-menu";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
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
  });

  async function render_menu(element: ReactNode): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(element));
  }

  function find_reset_item(): HTMLElement {
    const button = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent?.trim() === "workbench_page.action.reset",
    );
    if (button === undefined) {
      throw new Error("缺少重置动作");
    }
    return button;
  }

  it("打开下拉菜单准备操作目标，重置交给页面回调", async () => {
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

    await act(async () => trigger?.click());
    await act(async () => find_reset_item().click());
    expect(on_prepare_open).toHaveBeenCalledOnce();
    expect(on_reset).toHaveBeenCalledOnce();
  });
});
