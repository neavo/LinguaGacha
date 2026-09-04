import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchFileTable } from "./workbench-file-table";
import type { WorkbenchFileEntry } from "../types";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/app-table/app-table", () => ({
  AppTable: (props: {
    rows: WorkbenchFileEntry[];
    on_sort_change: (sort_state: AppTableSortState | null) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => props.on_sort_change({ column_id: "file", direction: "ascending" })}
      >
        sort
      </button>
      {props.rows.map((entry) => (
        <span key={entry.rel_path} data-testid="file-row">
          {entry.rel_path}
        </span>
      ))}
    </div>
  ),
}));

describe("WorkbenchFileTable", () => {
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

  it("按文件名排序时使用自然数字顺序", async () => {
    const entries: WorkbenchFileEntry[] = [
      { rel_path: "chapter10.txt", file_type: "TXT", sort_index: 0, item_count: 1 },
      { rel_path: "chapter2.txt", file_type: "TXT", sort_index: 1, item_count: 1 },
    ];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkbenchFileTable
          entries={entries}
          selected_entry_ids={[]}
          active_entry_id={null}
          anchor_entry_id={null}
          readonly={false}
          on_selection_change={() => {}}
          on_prepare_entry_action={() => {}}
          on_reset={() => {}}
          on_reorder={async () => {}}
        />,
      );
    });
    const read_rows = () =>
      [...(container?.querySelectorAll('[data-testid="file-row"]') ?? [])].map(
        (row) => row.textContent,
      );
    expect(read_rows()).toEqual(["chapter10.txt", "chapter2.txt"]);

    await act(async () => container?.querySelector("button")?.click());

    expect(read_rows()).toEqual(["chapter2.txt", "chapter10.txt"]);
  });
});
