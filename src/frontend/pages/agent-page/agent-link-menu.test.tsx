import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentLinkMenu } from "./agent-link-menu";

const report = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: report,
  push_toast: vi.fn(),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

it("只复制右键命中的文字选区，并报告剪贴板失败", async () => {
  const error = new Error("clipboard unavailable");
  const write_text = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(error);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentLinkMenu
          trigger={{ render: <a href="#target">显示文字</a>, className: "select-text" }}
          copy_href="#target"
        >
          {null}
        </AgentLinkMenu>,
      ),
    );
    const link = container.querySelector("a")!;
    window.getSelection()!.selectAllChildren(link);
    // jsdom 没有排版，为右键命中和未命中使用同一块选区。
    const rect = new DOMRect(4, 4, 40, 20);
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue(
      Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) }),
    );
    /** 观察应用菜单是否接管原生事件，以及是否提供复制文字。 */
    async function selection_item(clientX: number): Promise<HTMLElement | undefined> {
      const event = new MouseEvent("contextmenu", {
        button: 2,
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 10,
      });
      await act(async () => link.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === "agent_page.link.copy_selection",
      );
    }
    const copy = await selection_item(12);
    await act(async () => copy!.click());
    expect(write_text).toHaveBeenCalledExactlyOnceWith("显示文字");
    expect(report).toHaveBeenCalledExactlyOnceWith("app.feedback.copy_failed", error);
    expect(await selection_item(50)).toBeUndefined();
  } finally {
    window.getSelection()?.removeAllRanges();
    await act(async () => root.unmount());
    container.remove();
  }
});
