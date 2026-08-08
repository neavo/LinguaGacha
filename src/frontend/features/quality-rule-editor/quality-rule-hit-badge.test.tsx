import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QualityRuleHitBadge } from "./quality-rule-hit-badge";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <>{props.children}</>,
}));

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenu: (props: { children: ReactNode }) => <>{props.children}</>,
  AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  AppDropdownMenuContent: (props: { children: ReactNode }) => <>{props.children}</>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <>{props.children}</>,
  AppDropdownMenuItem: (props: { children: ReactNode; onClick: () => void }) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

describe("QualityRuleHitBadge", () => {
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

  async function render_badge(
    overrides: Partial<ComponentProps<typeof QualityRuleHitBadge>> = {},
  ): Promise<HTMLDivElement> {
    if (root !== null) {
      await act(async () => root?.unmount());
      container?.remove();
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <QualityRuleHitBadge
          entry_id="rule-1"
          running={false}
          badge_state={{ kind: "matched", hits: 2, tooltip: "命中 2" }}
          badge_class_name="badge"
          running_class_name="running"
          wrap_class_name="wrap"
          button_class_name="button"
          query_label="查询"
          relation_label="关系"
          on_query_entry_source={async () => {}}
          on_search_entry_relations={() => {}}
          {...overrides}
        />,
      );
    });
    return container;
  }

  it("命中徽章提供可访问名称并按 entry_id 查询", async () => {
    const on_query_entry_source = vi.fn(async () => {});
    const rendered = await render_badge({ on_query_entry_source });

    await act(async () => rendered.querySelector("button")?.click());

    expect(rendered.querySelector("button")?.getAttribute("aria-label")).toBe("命中 2");
    expect(on_query_entry_source).toHaveBeenCalledWith("rule-1");
  });

  it("关系徽章区分查询与关系动作，运行态不暴露旧结果", async () => {
    const on_query_entry_source = vi.fn(async () => {});
    const on_search_entry_relations = vi.fn();
    const rendered = await render_badge({
      badge_state: { kind: "related", hits: 1, tooltip: "存在父项" },
      on_query_entry_source,
      on_search_entry_relations,
    });
    const action_buttons = [...rendered.querySelectorAll("button")];

    await act(async () => action_buttons.find((button) => button.textContent === "查询")?.click());
    await act(async () => action_buttons.find((button) => button.textContent === "关系")?.click());

    expect(on_query_entry_source).toHaveBeenCalledWith("rule-1");
    expect(on_search_entry_relations).toHaveBeenCalledWith("rule-1");

    await render_badge({ running: true });
    expect(container?.textContent).not.toContain("2");
    expect(container?.querySelector('[aria-label="app.action.loading"]')).not.toBeNull();
  });
});
