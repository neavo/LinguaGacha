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

  it("点击修改游戏字体入口后进入对应页面", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ToolboxPage is_sidebar_collapsed={false} />);
    });

    const entry = get_button_by_name(container, "game_font_page.title");

    await act(async () => entry.click());

    expect(navigate_to_route_mock).toHaveBeenCalledWith("game-font");
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
