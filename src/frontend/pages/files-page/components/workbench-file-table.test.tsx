import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchFileTable } from "./workbench-file-table";
import type { WorkbenchFileEntry } from "@shared/workbench/workbench-query";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// 接入测试直接提供可见行，布局与虚拟化由通用表格测试验证。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: index,
        start: index * options.estimateSize(),
        end: (index + 1) * options.estimateSize(),
        size: options.estimateSize(),
      })),
    getTotalSize: () => options.count * options.estimateSize(),
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));

/** 文件排序场景只调整路径与后端提供的完成率。 */
function create_entry(rel_path: string, completion_percent = 33): WorkbenchFileEntry {
  return {
    rel_path,
    file_type: "TXT",
    sort_index: 0,
    progress: {
      total_items: 3,
      completed_count: 1,
      skipped_count: 0,
      pending_count: 2,
      completion_percent,
    },
  };
}

describe("WorkbenchFileTable", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  /** 挂载真实表格，覆盖页面列配置与通用表格的接入。 */
  async function render(
    entries: WorkbenchFileEntry[],
    actions = { rename: vi.fn(), reset: vi.fn() },
    selected_entry_ids: string[] = [],
  ): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <TooltipProvider delay={0}>
          <WorkbenchFileTable
            entries={entries}
            selected_entry_ids={selected_entry_ids}
            active_entry_id={null}
            anchor_entry_id={null}
            readonly={false}
            on_selection_change={() => {}}
            on_rename={actions.rename}
            on_reset={actions.reset}
            on_reorder={async () => {}}
          />
        </TooltipProvider>,
      ),
    );
  }

  it.each(["rename", "reset"] as const)("右键多选中的文件时 %s 点击的文件", async (action) => {
    const actions = { rename: vi.fn(), reset: vi.fn() };
    await render([create_entry("a.txt"), create_entry("b.txt")], actions, ["a.txt", "b.txt"]);
    const row = container.querySelector<HTMLElement>(
      '.app-table__table--body [data-row-index="1"]',
    )!;
    await act(async () =>
      row.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
      ),
    );
    const menu_item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes(`workbench_page.action.${action}`),
    );
    expect(menu_item).toBeDefined();
    await act(async () => menu_item!.click());
    expect(actions[action]).toHaveBeenCalledExactlyOnceWith("b.txt");
    expect(actions[action === "rename" ? "reset" : "rename"]).not.toHaveBeenCalled();
  });

  it("按文件名自然排序，按进度排序时同值使用路径顺序并可恢复工程顺序", async () => {
    await render([
      create_entry("chapter10.txt", 33),
      create_entry("chapter2.txt", 33),
      create_entry("chapter1.txt", 100),
    ]);
    const read_paths = () =>
      [...container.querySelectorAll(".workbench-page__table-file-text")].map((e) => e.textContent);
    const sort_buttons = container.querySelectorAll<HTMLButtonElement>(".app-table__sort-trigger");
    await act(async () => sort_buttons[0]?.click());
    expect(read_paths()).toEqual(["chapter1.txt", "chapter2.txt", "chapter10.txt"]);
    await act(async () => sort_buttons[1]?.click());
    expect(read_paths()).toEqual(["chapter2.txt", "chapter10.txt", "chapter1.txt"]);
    await act(async () => sort_buttons[1]?.click());
    expect(read_paths()).toEqual(["chapter1.txt", "chapter10.txt", "chapter2.txt"]);
    await act(async () => sort_buttons[1]?.click());
    expect(read_paths()).toEqual(["chapter10.txt", "chapter2.txt", "chapter1.txt"]);
  });
});
