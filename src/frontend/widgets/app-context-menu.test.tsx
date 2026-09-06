import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AppContextMenu, AppContextMenuContent, AppContextMenuTrigger } from "./app-context-menu";

it("右键菜单窗口失活后关闭，原触发器可以重新打开", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AppContextMenu>
          <AppContextMenuTrigger>菜单</AppContextMenuTrigger>
          <AppContextMenuContent>选项</AppContextMenuContent>
        </AppContextMenu>,
      ),
    );
    const trigger = host.querySelector<HTMLElement>('[data-slot="context-menu-trigger"]')!;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () =>
        trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 })),
      );
      expect(document.querySelector('[role="menu"][data-open]')).not.toBeNull();
      await act(async () => window.dispatchEvent(new Event("blur")));
      expect(document.querySelector('[role="menu"][data-open]')).toBeNull();
      expect(host.querySelector('[data-slot="context-menu-trigger"]')).toBe(trigger);
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
