import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingFilterDialog } from "./proofreading-filter-dialog";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/app-page-dialog", () => ({
  AppPageDialog: (props: { open: boolean; children: ReactNode; footer?: ReactNode }) =>
    props.open ? (
      <div>
        {props.children}
        {props.footer}
      </div>
    ) : null,
}));

vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  TooltipTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  TooltipContent: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
}));

const filters = {
  outcomes: [],
  glossary_entry_ids: [],
  include_without_glossary_miss: true,
};

const panel = {
  available_outcomes: ["CUSTOM"],
  outcome_count_by_code: { CUSTOM: 2 },

  glossary_term_entries: [],
  without_glossary_miss_count: 0,
};

describe("ProofreadingFilterDialog", () => {
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

  async function render_dialog(
    props: Partial<ComponentProps<typeof ProofreadingFilterDialog>> = {},
  ): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_change = props.on_change ?? vi.fn();

    await act(async () => {
      root?.render(
        <ProofreadingFilterDialog
          open
          filters={filters}
          panel={panel}
          loading={false}
          on_change={on_change}
          on_confirm={async () => {}}
          on_close={() => {}}
          {...props}
        />,
      );
    });
    return container;
  }

  it("切换结果时提交新的筛选值且不修改输入对象", async () => {
    const on_change = vi.fn();
    const rendered = await render_dialog({ on_change });
    const status_button = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("CUSTOM"),
    );

    await act(async () => status_button?.click());

    expect(on_change).toHaveBeenCalledWith(expect.objectContaining({ outcomes: ["CUSTOM"] }));
    expect(filters.outcomes).toEqual([]);
  });

  it("分组使用右侧三态选择并批量切换子项", async () => {
    const on_change = vi.fn();
    const rendered = await render_dialog({
      on_change,
      filters: {
        ...filters,
        outcomes: ["NO_WARNING", "ERROR", "NONE"],
      },
      panel: {
        ...panel,
        available_outcomes: ["NO_WARNING", "FOREIGN_CHAR_RESIDUE", "ERROR", "NONE", "EXCLUDED"],
        outcome_count_by_code: {
          NO_WARNING: 2,
          FOREIGN_CHAR_RESIDUE: 1,
          ERROR: 3,
          NONE: 4,
          EXCLUDED: 5,
        },
      },
    });
    const translated_group = rendered.querySelector(
      '[role="checkbox"][aria-label^="proofreading_page.filter.translated_group"]',
    );
    const unfinished_group = rendered.querySelector(
      '[role="checkbox"][aria-label^="proofreading_page.filter.unfinished_group"]',
    );
    const not_required_group = rendered.querySelector(
      '[role="checkbox"][aria-label^="proofreading_page.filter.not_required_group"]',
    );

    expect(translated_group?.getAttribute("aria-checked")).toBe("mixed");
    expect(unfinished_group?.getAttribute("aria-checked")).toBe("true");
    expect(not_required_group?.getAttribute("aria-checked")).toBe("false");

    await act(async () => (translated_group as HTMLButtonElement | undefined)?.click());

    expect(on_change).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomes: ["NO_WARNING", "ERROR", "NONE", "FOREIGN_CHAR_RESIDUE"],
      }),
    );
  });

  it("同文案术语仍按 entry_id 独立切换", async () => {
    const on_change = vi.fn();
    const rendered = await render_dialog({
      on_change,
      panel: {
        ...panel,
        glossary_term_entries: [
          { entry_id: "first", src: "HP", dst: "生命值", count: 1 },
          { entry_id: "second", src: "HP", dst: "生命值", count: 2 },
        ],
      },
    });
    const term_buttons = [...rendered.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("HP -> 生命值"),
    );

    await act(async () => term_buttons[1]?.click());

    expect(on_change).toHaveBeenCalledWith(
      expect.objectContaining({ glossary_entry_ids: ["second"] }),
    );
  });
  it.each([
    { ids: [], include_without: false, checked: "false" },
    { ids: ["first"], include_without: true, checked: "mixed" },
    { ids: ["first", "second"], include_without: false, checked: "mixed" },
    { ids: ["first", "second"], include_without: true, checked: "true" },
  ])(
    "术语组 $checked 使用三态切换，搜索不缩小全选范围",
    async ({ ids, include_without, checked }) => {
      const on_change = vi.fn();
      const rendered = await render_dialog({
        on_change,
        filters: {
          outcomes: ["NONE"],
          glossary_entry_ids: ids,
          include_without_glossary_miss: include_without,
        },
        panel: {
          ...panel,
          glossary_term_entries: [
            { entry_id: "first", src: "HP", dst: "生命值", count: 2 },
            { entry_id: "second", src: "MP", dst: "魔力", count: 1 },
          ],
        },
      });
      const group = rendered.querySelector<HTMLButtonElement>(
        '[role="checkbox"][aria-label^="proofreading_page.filter.glossary_detail"]',
      )!;
      expect(group.getAttribute("aria-checked")).toBe(checked);
      const input = rendered.querySelector("input")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "HP",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(rendered.textContent).not.toContain("MP -> 魔力");
      expect(group.getAttribute("aria-checked")).toBe(checked);
      await act(async () => group.click());
      expect(on_change).toHaveBeenLastCalledWith({
        outcomes: ["NONE"],
        glossary_entry_ids: checked === "true" ? [] : ["first", "second"],
        include_without_glossary_miss: checked !== "true",
      });
    },
  );
});
