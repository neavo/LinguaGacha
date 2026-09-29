import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useDevicePixelRatio } from "./use-device-pixel-ratio";

it("跨屏更新像素比，重新监听新分辨率并在卸载时清理", async () => {
  let ratio = 1;
  const queries: (EventTarget & { removeEventListener: ReturnType<typeof vi.fn> })[] = [];
  vi.spyOn(window, "devicePixelRatio", "get").mockImplementation(() => ratio);
  const match = vi.spyOn(window, "matchMedia").mockImplementation(() => {
    const target = new EventTarget();
    const remove = vi.spyOn(target, "removeEventListener");
    queries.push(Object.assign(target, { removeEventListener: remove }));
    return target as MediaQueryList;
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  /** 通过实际渲染值观察 Hook 更新。 */
  function Reader() {
    return <span>{useDevicePixelRatio()}</span>;
  }
  try {
    await act(async () => root.render(<Reader />));
    expect(container.textContent).toBe("1");
    for (const next of [2, 1.25]) {
      const previous = queries.at(-1)!;
      ratio = next;
      await act(async () => previous.dispatchEvent(new Event("change")));
      expect(container.textContent).toBe(String(next));
      expect(previous.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
      expect(match).toHaveBeenLastCalledWith(`(resolution: ${next}dppx)`);
    }
  } finally {
    await act(async () => root.unmount());
    expect(queries.at(-1)!.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    vi.restoreAllMocks();
  }
});
