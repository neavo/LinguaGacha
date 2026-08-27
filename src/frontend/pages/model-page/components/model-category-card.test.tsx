import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelCategoryCard } from "./model-category-card";

type DragResult = {
  active: { id: string };
  over: { id: string } | null;
};

const dnd_state = vi.hoisted(() => ({
  on_drag_end: null as ((event: DragResult) => void) | null,
}));

vi.mock("@dnd-kit/core", async (import_original) => {
  const mock_module = {
    ...(await import_original<typeof import("@dnd-kit/core")>()),
    DndContext: (props: { children: ReactNode; onDragEnd: (event: DragResult) => void }) => {
      dnd_state.on_drag_end = props.onDragEnd;
      return <>{props.children}</>;
    },
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...sensors: unknown[]) => sensors),
  };
  return { ...mock_module, default: mock_module };
});

vi.mock("@dnd-kit/sortable", async (import_original) => {
  const mock_module = {
    ...(await import_original<typeof import("@dnd-kit/sortable")>()),
    SortableContext: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
  };
  return { ...mock_module, default: mock_module };
});

describe("ModelCategoryCard", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    dnd_state.on_drag_end = null;
  });

  it("只提交同组模型的完整拖拽顺序", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_reorder = vi.fn();

    await act(async () => {
      root?.render(
        <ModelCategoryCard
          title="OpenAI Responses"
          description="兼容 OpenAI Responses API 格式的自定义模型"
          accent_color="teal"
          models={[create_model_snapshot({ id: "first" }), create_model_snapshot({ id: "second" })]}
          add_action={<button type="button">新增</button>}
          on_reorder={on_reorder}
        >
          <span>模型列表</span>
        </ModelCategoryCard>,
      );
    });

    dnd_state.on_drag_end?.({ active: { id: "first" }, over: { id: "second" } });
    dnd_state.on_drag_end?.({ active: { id: "outside" }, over: { id: "second" } });

    expect(on_reorder).toHaveBeenCalledOnce();
    expect(on_reorder).toHaveBeenCalledWith(["second", "first"]);
  });
});
