import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolboxPage } from "./page";

const navigate_to_route_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_route: navigate_to_route_mock }),
}));

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("ToolboxPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("点击工具入口后进入对应页面", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ToolboxPage is_sidebar_collapsed={false} />);
    });

    for (const [title, route] of [
      ["game_font_page.title", "game-font"],
      ["translation_transfer_page.title", "translation-transfer"],
    ] as const) {
      await act(async () => get_button_by_name(container!, title).click());
      expect(navigate_to_route_mock).toHaveBeenLastCalledWith(route);
    }
  });
});

/** 按入口名称操作页面，路由断言由调用用例负责。 */
function get_button_by_name(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (button === undefined) {
    throw new Error(`缺少按钮：${name}`);
  }
  return button;
}
