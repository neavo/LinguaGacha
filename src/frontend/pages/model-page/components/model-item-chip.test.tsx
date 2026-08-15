import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelItemChip } from "./model-item-chip";

const { use_sortable_mock } = vi.hoisted(() => ({
  use_sortable_mock: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", async (import_original) => {
  const mock_module = {
    ...(await import_original<typeof import("@dnd-kit/sortable")>()),
    useSortable: use_sortable_mock,
  };
  return { ...mock_module, default: mock_module };
});

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
}));

describe("ModelItemChip", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    use_sortable_mock.mockReset();
    use_sortable_mock.mockReturnValue({
      attributes: {},
      isDragging: false,
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
    });
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("禁用拖拽时保留可用的配置入口", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelItemChip
          model={create_model_snapshot({ name: "翻译模型" })}
          drag_disabled={true}
          drag_aria_label="拖拽翻译模型"
          menu={<button type="button">配置动作</button>}
        />,
      );
    });

    const drag_button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="拖拽翻译模型"]',
    );
    const model_button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "翻译模型",
    );

    expect(drag_button?.disabled).toBe(true);
    expect(model_button?.disabled).toBe(false);
  });
});
