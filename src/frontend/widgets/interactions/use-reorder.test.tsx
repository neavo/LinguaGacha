import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragDropManager, DragStartEvent, DragOverEvent, DragEndEvent } from "@dnd-kit/react";

import { useReorder } from "./use-reorder";

describe("useReorder", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let reorder: ReturnType<typeof useReorder>;
  const stop = vi.fn();
  const manager = {
    actions: { stop },
    registry: { draggables: { get: () => ({ handle: container.querySelector("button") }) } },
  } as unknown as DragDropManager;
  const source = { id: "a" };
  const target = { id: "c" };
  const start = { operation: { source } } as DragStartEvent;
  const over = { operation: { source, target } } as DragOverEvent;
  const end = { canceled: false, operation: { source, target } } as DragEndEvent;

  /** 通过公开顺序和按钮禁用态观察 Hook 生命周期。 */
  function Fixture(props: Parameters<typeof useReorder>[0]): JSX.Element {
    reorder = useReorder(props);
    return (
      <div>
        {reorder.ordered_ids.join(",")}
        <button aria-label="移动" disabled={reorder.pending} />
      </div>
    );
  }

  /** 在同一组件身份下更新外部数据，模拟命令和事件回流。 */
  async function render(props: Parameters<typeof useReorder>[0]): Promise<void> {
    if (root === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<Fixture {...props} />));
  }

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    root = null;
    stop.mockClear();
  });

  it("同一帧落点与松手提交最新预览，保存期间阻止第二次提交", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const save = vi.fn(() => pending);
    await render({ ids: ["a", "b", "c"], disabled: false, on_reorder: save });
    act(() => {
      reorder.events.onDragStart(start, manager);
      reorder.events.onDragOver(over, manager);
      reorder.events.onDragEnd(end, manager);
      reorder.submit(["c", "b", "a"]);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(["b", "c", "a"]);
    expect(container.textContent).toBe("b,c,a");
    await act(async () => finish());
  });

  it("键盘保存结束后恢复手柄焦点，用户转向其它控件时保留新焦点", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let finish!: () => void;
    const save = (): Promise<void> =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await render({ ids: ["a", "b", "c"], disabled: false, on_reorder: save });
    const handle = container.querySelector("button")!;
    const other = document.createElement("button");
    container.append(other);
    const keyboard_start = {
      cancelable: false,
      operation: {
        source: { ...source, handle },
        activatorEvent: new KeyboardEvent("keydown", { code: "Space" }),
      },
    } as unknown as DragStartEvent;
    for (const change_focus of [false, true]) {
      handle.focus();
      act(() => {
        reorder.events.onDragStart(keyboard_start, manager);
        reorder.events.onDragOver(over, manager);
        reorder.events.onDragEnd(end, manager);
      });
      // happy-dom 忽略禁用按钮的 blur，用 body 焦点模拟 Chromium 的失焦结果。
      document.body.focus();
      expect(document.activeElement).toBe(document.body);
      if (change_focus) other.focus();
      await act(async () => finish());
      expect(document.activeElement).toBe(change_focus ? other : handle);
    }
  });

  it.each(["cancel", "blur", "members", "permission"] as const)(
    "%s 结束预览并交回当前数据，不提交过期顺序",
    async (reason) => {
      const save = vi.fn(async () => {});
      const props = { ids: ["a", "b", "c"], disabled: false, on_reorder: save };
      await render(props);
      act(() => {
        reorder.events.onDragStart(start, manager);
        reorder.events.onDragOver(over, manager);
      });
      expect(container.textContent).toBe("b,c,a");
      if (reason === "members") {
        await render({ ...props, ids: ["b", "c", "d"] });
      } else if (reason === "permission") {
        await render({ ...props, disabled_ids: ["a"] });
      } else if (reason === "blur") {
        act(() => window.dispatchEvent(new Event("blur")));
      } else {
        act(() => reorder.events.onDragEnd({ ...end, canceled: true }, manager));
      }
      act(() => reorder.events.onDragEnd(end, manager));
      expect(save).not.toHaveBeenCalled();
      expect(container.textContent).toBe(reason === "members" ? "b,c,d" : "a,b,c");
      expect(reorder.active_id).toBeNull();
      if (reason !== "cancel") expect(stop).toHaveBeenCalledWith({ canceled: true });
    },
  );
});
