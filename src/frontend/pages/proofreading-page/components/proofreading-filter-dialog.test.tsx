import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingFilterDialog } from "./proofreading-filter-dialog";

vi.mock("@frontend/app/locale/locale-provider", () => ({
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
  warning_types: [],
  statuses: [],
  file_paths: ["chapter01.txt", "appendix.txt"],
  glossary_entry_ids: [],
  include_without_glossary_miss: true,
};

const panel = {
  available_statuses: ["CUSTOM"],
  status_count_by_code: { CUSTOM: 2 },
  available_warning_types: [],
  warning_count_by_code: {},
  all_file_paths: ["chapter01.txt", "appendix.txt"],
  available_file_paths: ["chapter01.txt", "appendix.txt"],
  file_count_by_path: { "chapter01.txt": 1, "appendix.txt": 1 },
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

  it("切换状态时提交新的筛选值且不修改输入对象", async () => {
    const on_change = vi.fn();
    const rendered = await render_dialog({ on_change });
    const status_button = [...rendered.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("CUSTOM"),
    );

    await act(async () => status_button?.click());

    expect(on_change).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["CUSTOM"] }));
    expect(filters.statuses).toEqual([]);
  });

  it("文件关键字只保留匹配项", async () => {
    const rendered = await render_dialog();
    const file_search = rendered.querySelectorAll("input")[0];
    if (!(file_search instanceof HTMLInputElement)) {
      throw new Error("缺少文件筛选输入框");
    }

    await act(async () => {
      const value_setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      value_setter?.call(file_search, "appendix");
      file_search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(rendered.textContent).toContain("appendix.txt");
    expect(rendered.textContent).not.toContain("chapter01.txt");
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
});
