import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentFileDropTarget } from "./agent-file-drop-target";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AgentFileDropTarget", () => {
  let root: Root | null = null;
  let target: HTMLDivElement;
  const target_ref = createRef<HTMLElement>();
  const on_files = vi.fn(async (_files: readonly File[]) => undefined);

  afterEach(async () => {
    await act(async () => root?.unmount());
    target?.remove();
    target_ref.current = null;
    root = null;
    on_files.mockClear();
  });

  /** 重渲染同一区域以验证禁用状态迁移，事件仍经过真实 DOM。 */
  async function render_target(enabled = true): Promise<void> {
    if (root === null) {
      target = document.createElement("div");
      const content = document.createElement("div");
      target.append(content);
      document.body.append(target);
      target_ref.current = target;
      root = createRoot(content);
    }
    await act(async () =>
      root?.render(
        <AgentFileDropTarget target_ref={target_ref} enabled={enabled} on_files={on_files} />,
      ),
    );
  }

  /** 遮罩的激活属性同时控制可见反馈。 */
  function overlay_visible(): boolean {
    return target.querySelector('[data-active="true"]') !== null;
  }

  it("跨子元素移动保持遮罩，离开区域、放下和窗口失焦结束反馈", async () => {
    await render_target();
    const child = target.firstElementChild!;
    await dispatch_drag(target, "dragenter");
    await dispatch_drag(child, "dragenter");
    await dispatch_drag(target, "dragleave");
    expect(overlay_visible()).toBe(true);
    await dispatch_drag(child, "dragleave");
    expect(overlay_visible()).toBe(false);

    await dispatch_drag(child, "dragenter");
    const file = new File([], "image.png", { type: "image/png" });
    const drop = await dispatch_drag(child, "drop", [file]);
    expect(drop.defaultPrevented).toBe(true);
    expect(on_files).toHaveBeenCalledExactlyOnceWith([file]);
    expect(overlay_visible()).toBe(false);

    await dispatch_drag(child, "dragenter");
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(overlay_visible()).toBe(false);
  });

  it("禁用立即清除反馈并拒绝文件，恢复后可继续接收", async () => {
    await render_target();
    await dispatch_drag(target, "dragenter");
    await render_target(false);
    expect(overlay_visible()).toBe(false);
    const over = await dispatch_drag(target, "dragover");
    expect(over.dataTransfer?.dropEffect).toBe("none");
    expect((await dispatch_drag(target, "drop")).defaultPrevented).toBe(true);
    expect(on_files).not.toHaveBeenCalled();
    await render_target();
    expect(overlay_visible()).toBe(false);
    await dispatch_drag(target, "dragenter");
    expect(overlay_visible()).toBe(true);
    expect((await dispatch_drag(target, "dragover")).dataTransfer?.dropEffect).toBe("copy");
  });

  it("普通文本拖拽保持原生传播，卸载后移除区域监听", async () => {
    await render_target();
    const bubbling = vi.fn();
    document.body.addEventListener("drop", bubbling);
    try {
      const event = await dispatch_drag(target, "drop", [], ["text/plain"]);
      expect(event.defaultPrevented).toBe(false);
      expect(bubbling).toHaveBeenCalledOnce();
      expect(on_files).not.toHaveBeenCalled();
      await act(async () => root?.unmount());
      root = null;
      expect((await dispatch_drag(target, "drop")).defaultPrevented).toBe(false);
    } finally {
      document.body.removeEventListener("drop", bubbling);
    }
  });
});

/** happy-dom 文件拖拽载荷由测试显式提供，其余沿真实 DOM 冒泡。 */
async function dispatch_drag(
  target: Element,
  type: string,
  files: readonly File[] = [],
  types: readonly string[] = ["Files"],
): Promise<DragEvent> {
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, files, dropEffect: "none" } });
  await act(async () => target.dispatchEvent(event));
  return event;
}
