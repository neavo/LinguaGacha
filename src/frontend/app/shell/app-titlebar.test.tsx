import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppTitlebar } from "./app-titlebar";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

const sidebar_mock = vi.hoisted(() => ({
  state: "expanded" as "expanded" | "collapsed",
  toggle_sidebar: vi.fn(),
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/shadcn/sidebar", () => ({
  useSidebar: () => ({
    state: sidebar_mock.state,
    toggleSidebar: sidebar_mock.toggle_sidebar,
  }),
}));

describe("AppTitlebar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    sidebar_mock.state = "expanded";
    sidebar_mock.toggle_sidebar.mockReset();
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({ shell: { titleBarControlSide: "right" } }),
    });
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("展示宿主标题栏方位，并由菜单按钮切换侧栏", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AppTitlebar title="LinguaGacha" />);
    });

    expect(container.querySelector("header")?.dataset.titlebarControlSide).toBe("right");
    expect(container.querySelector("strong")?.textContent).toBe("LinguaGacha");
    const toggle_button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="app.aria.toggle_navigation"]',
    );
    if (toggle_button === null) {
      throw new Error("缺少侧栏切换按钮。");
    }

    await act(async () => {
      toggle_button.click();
    });

    expect(sidebar_mock.toggle_sidebar).toHaveBeenCalledTimes(1);
  });
});
