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
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
}));

import { TextReplacementTable } from "./text-replacement-table";

describe("TextReplacementTable", () => {
  it("呈现替换规则状态与可访问的统计加载状态", () => {
    const html = renderToStaticMarkup(
      <TextReplacementTable
        title_key="pre_translation_replacement_page.title"
        entries={[
          {
            entry_id: "hero::0",
            source_index: 0,
            entry: {
              entry_id: "hero::0",
              src: "hero",
              dst: "勇者",
              regex: true,
              case_sensitive: false,
            },
          },
        ]}
        sort_state={null}
        readonly={false}
        drag_disabled={false}
        hit_running
        hit_ready={false}
        selected_entry_ids={[]}
        active_entry_id={null}
        anchor_entry_id={null}
        restore_scroll_entry_id={null}
        hit_badge_by_entry_id={{}}
        on_sort_change={vi.fn()}
        on_selection_change={vi.fn()}
        on_open_edit={vi.fn()}
        on_toggle_regex={vi.fn(async () => undefined)}
        on_toggle_case_sensitive={vi.fn(async () => undefined)}
        on_reorder={vi.fn(async () => undefined)}
        on_query_entry_source={vi.fn(async () => undefined)}
        on_search_entry_relations={vi.fn()}
      />,
    );

    expect(html).toContain("pre_translation_replacement_page.title");
    expect(html).toContain("hero");
    expect(html).toContain("勇者");
    expect(html).toContain('data-state="active"');
    expect(html).toContain('data-state="inactive"');
    expect(html).toContain("app.action.loading");
    expect(html).toContain('data-column-id="hit" data-sort-disabled="true"');
  });
});
