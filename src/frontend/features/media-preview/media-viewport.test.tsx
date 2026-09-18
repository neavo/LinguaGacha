import { act } from "react";
import { createRoot } from "react-dom/client";
import { MediaViewport } from "@frontend/features/media-preview/media-viewport";
import { expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

it("画布滚轮取消外层滚动，拖动限制边界，重置恢复居中适应", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MediaViewport label="图片">
          <img src="data:image/png;base64,aQ==" alt="图片" />
        </MediaViewport>,
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(32);
    });
    const viewport = container.querySelector<HTMLElement>(".media-viewport__viewport")!;
    const content = container.querySelector<HTMLElement>(".media-viewport__content")!;
    const initial_transform = content.style.transform;
    const wheel = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    });
    // happy-dom 的 `WheelEvent` 未初始化鼠标坐标，补齐真实浏览器提供的字段。
    Object.defineProperties(wheel, { clientX: { value: 0 }, clientY: { value: 0 } });
    await act(async () => viewport.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(content.style.transform).not.toBe(initial_transform);
    viewport.setPointerCapture = vi.fn();
    viewport.hasPointerCapture = () => true;
    viewport.releasePointerCapture = vi.fn();
    await act(async () =>
      viewport.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          button: 0,
          clientX: 0,
          clientY: 0,
          bubbles: true,
        }),
      ),
    );
    await act(async () =>
      viewport.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 999,
          clientY: 999,
          bubbles: true,
        }),
      ),
    );
    const boundary_transform = content.style.transform;
    expect(boundary_transform).not.toContain("translate3d(0px, 0px, 0)");
    await act(async () =>
      viewport.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 1999,
          clientY: 1999,
          bubbles: true,
        }),
      ),
    );
    expect(content.style.transform).toBe(boundary_transform);
    await act(async () =>
      viewport.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true })),
    );
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
    await act(async () =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true })),
    );
    expect(content.style.transform).toBe(initial_transform);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
