import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { SidebarProvider } from "./sidebar";
import { useSidebar } from "./sidebar-context";

/** 通过公共上下文观察宿主控制的状态与切换请求。 */
function SidebarControl() {
  const { open, toggleSidebar } = useSidebar();
  return <button aria-expanded={open} onClick={toggleSidebar} />;
}

it("受控侧栏等待宿主确认状态，再按新状态发出切换请求", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const on_change = vi.fn();
  try {
    await act(async () =>
      root.render(
        <SidebarProvider open onOpenChange={on_change}>
          <SidebarControl />
        </SidebarProvider>,
      ),
    );
    const button = container.querySelector("button");
    if (button === null) throw new Error("缺少侧栏控制按钮。");
    await act(async () => button.click());
    expect(on_change).toHaveBeenCalledExactlyOnceWith(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    await act(async () =>
      root.render(
        <SidebarProvider open={false} onOpenChange={on_change}>
          <SidebarControl />
        </SidebarProvider>,
      ),
    );
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button.click());
    expect(on_change.mock.calls).toEqual([[false], [true]]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
