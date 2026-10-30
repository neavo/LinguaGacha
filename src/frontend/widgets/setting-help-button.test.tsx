import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { SettingHelpButton } from "./setting-help-button";

vi.mock("@frontend/app/desktop/desktop-api", () => ({ open_external_url: vi.fn() }));

it("悬停显示帮助名称，点击打开对应的外部说明", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const url = "https://example.com/help";
  try {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <SettingHelpButton url={url} label="功能帮助" />
        </TooltipProvider>,
      ),
    );
    const button = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe(
      button.getAttribute("aria-label"),
    );
    await act(async () => button.click());
    expect(open_external_url).toHaveBeenCalledExactlyOnceWith(url);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
