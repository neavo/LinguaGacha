import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { toast } from "sonner";
import { DesktopProgressToast } from "./desktop-progress-toast";
import { dismiss_toast, push_progress_toast, read_progress_toast } from "./desktop-toast";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }) }));

it("通知与遮罩消费同一快照，展示重挂载后仍可结束原任务", async () => {
  const container = document.createElement("div");
  let root = createRoot(container);
  const id = push_progress_toast({ message: "处理中", presentation: "modal" });
  try {
    await act(async () => root.render(<DesktopProgressToast />));
    expect(container.querySelector(".cn-progress-toast-modal-layer")).not.toBeNull();
    expect(toast).toHaveBeenLastCalledWith("处理中", expect.anything());
    const snapshot = read_progress_toast();
    await act(async () => root.unmount());
    expect(toast.dismiss).toHaveBeenCalled();
    expect(read_progress_toast()).toBe(snapshot);
    root = createRoot(container);
    await act(async () => root.render(<DesktopProgressToast />));
    expect(container.querySelector(".cn-progress-toast-modal-layer")).not.toBeNull();
    vi.mocked(toast.dismiss).mockClear();
    await act(async () => dismiss_toast(id));
    expect(container.querySelector(".cn-progress-toast-modal-layer")).toBeNull();
    expect(toast.dismiss).toHaveBeenCalledOnce();
  } finally {
    await act(async () => {
      dismiss_toast(id);
      root.unmount();
    });
  }
});
