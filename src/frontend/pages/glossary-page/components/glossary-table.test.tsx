import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppTableColumn } from "@frontend/widgets/app-table/app-table-types";
import { GlossaryTable } from "./glossary-table";
import type { GlossaryVisibleEntry } from "../types";

const capture = vi.hoisted(() => ({ columns: [] as AppTableColumn<GlossaryVisibleEntry>[] }));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => (key === "glossary_page.fields.hit" ? "命中" : key),
  }),
}));

vi.mock("@frontend/widgets/app-table/app-table", () => ({
  AppTable: (props: { columns: AppTableColumn<GlossaryVisibleEntry>[] }) => {
    capture.columns = props.columns;
    return <div data-testid="table" />;
  },
}));

describe("GlossaryTable", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    capture.columns = [];
  });

  it("以 hit 作为唯一术语命中列和排序 ID", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <GlossaryTable
          entries={[]}
          sort_state={{ field: null, direction: null }}
          readonly={false}
          drag_disabled={false}
          hit_sort_available={true}
          selected_entry_ids={[]}
          active_entry_id={null}
          anchor_entry_id={null}
          restore_scroll_entry_id={null}
          hit_badge_by_entry_id={{}}
          on_sort_change={() => {}}
          on_selection_change={() => {}}
          on_open_edit={() => {}}
          on_toggle_case_sensitive={async () => {}}
          on_reorder={async () => {}}
          on_query_entry_source={async () => {}}
          on_search_entry_relations={() => {}}
        />,
      );
    });

    expect(capture.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "hit", title: "命中" })]),
    );
    expect(capture.columns.some((column) => column.id === "statistics")).toBe(false);
  });
});
