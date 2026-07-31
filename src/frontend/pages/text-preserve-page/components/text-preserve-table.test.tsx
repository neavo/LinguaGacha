import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

type TableProbeRow = { entry_id: string; [key: string]: unknown };
type TableProbeColumn = {
  id: string;
  title: ReactNode;
  sortable?: { disabled?: boolean };
  render_cell: (payload: {
    row: TableProbeRow;
    row_id: string;
    row_index: number;
    can_drag: boolean;
    dragging: boolean;
    presentation: "normal";
  }) => ReactNode;
};

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/widgets/app-table/app-table", () => ({
  AppTable: (props: { rows: TableProbeRow[]; columns: TableProbeColumn[] }) => {
    const row = props.rows[0];
    if (row === undefined) return <div />;
    return (
      <div>
        {props.columns
          .filter((column) => column.id !== "drag")
          .map((column) => (
            <section
              key={column.id}
              data-column-id={column.id}
              data-sort-disabled={column.sortable?.disabled || undefined}
            >
              <h2>{column.title}</h2>
              {column.render_cell({
                row,
                row_id: row.entry_id,
                row_index: 0,
                can_drag: false,
                dragging: false,
                presentation: "normal",
              })}
            </section>
          ))}
      </div>
    );
  },
}));

import { TextPreserveTable } from "./text-preserve-table";

describe("TextPreserveTable", () => {
  it("呈现规则内容与可访问的统计加载状态，并在统计未就绪时禁用排序", () => {
    const html = renderToStaticMarkup(
      <TextPreserveTable
        title_key="text_preserve_page.title"
        entries={[
          {
            entry_id: "foo::0",
            source_index: 0,
            entry: { entry_id: "foo::0", src: "foo", info: "备注" },
          },
        ]}
        sort_state={null}
        readonly={false}
        drag_disabled={false}
        statistics_running
        statistics_ready={false}
        selected_entry_ids={[]}
        active_entry_id={null}
        anchor_entry_id={null}
        restore_scroll_entry_id={null}
        statistics_badge_by_entry_id={{}}
        on_sort_change={vi.fn()}
        on_selection_change={vi.fn()}
        on_open_edit={vi.fn()}
        on_reorder={vi.fn(async () => undefined)}
        on_query_entry_source={vi.fn(async () => undefined)}
        on_search_entry_relations={vi.fn()}
      />,
    );

    expect(html).toContain("text_preserve_page.title");
    expect(html).toContain("foo");
    expect(html).toContain("备注");
    expect(html).toContain("app.action.loading");
    expect(html).toContain('data-column-id="statistics" data-sort-disabled="true"');
  });
});
