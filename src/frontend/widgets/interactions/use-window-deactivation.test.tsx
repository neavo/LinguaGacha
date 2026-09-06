import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useWindowDeactivation } from "./use-window-deactivation";

it("窗口失活使用最新回调，页面可见与卸载后不触发", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const first = vi.fn();
  const latest = vi.fn();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  function Probe({ on_deactivate }: { on_deactivate: () => void }): null {
    useWindowDeactivation(on_deactivate);
    return null;
  }
  try {
    await act(async () => root.render(<Probe on_deactivate={first} />));
    await act(async () => root.render(<Probe on_deactivate={latest} />));
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(latest).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    hidden.mockRestore();
  }
  window.dispatchEvent(new Event("blur"));
  expect(latest).toHaveBeenCalledTimes(2);
});
