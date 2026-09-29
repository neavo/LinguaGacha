import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { SidebarProvider } from "@frontend/shadcn/sidebar";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { get_shortcut_label } from "@frontend/widgets/interactions/keyboard-shortcuts";
import { AppTitlebar } from "./app-titlebar";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

describe("AppTitlebar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** 使用真实侧栏状态验证标题栏，重复注册快捷键会导致切换断言失败。 */
  async function render_titlebar(): Promise<HTMLButtonElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider delay={0}>
            <SidebarProvider>
              <AppTitlebar title="LinguaGacha" />
            </SidebarProvider>
          </TooltipProvider>
        </LocaleProvider>,
      );
    });
    const button = container.querySelector<HTMLButtonElement>(".topbar__menu-button");
    if (button === null) throw new Error("缺少侧栏切换按钮。");
    return button;
  }

  it.each(["1.2.3", "v1.2.3"])("统一展示宿主版本 %s 的前缀", async (version) => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({ appVersion: version }),
    });
    await render_titlebar();

    expect(container?.querySelector("strong")?.textContent).toBe("LinguaGacha v1.2.3");
  });

  it("提示与切换状态一致，点击和快捷键共用入口并避开输入框", async () => {
    const button = await render_titlebar();
    await act(async () => {
      button.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      button.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      vi.runAllTimers();
    });
    const tooltip = document.querySelector('[role="tooltip"][data-open]');
    const expanded_label = button.getAttribute("aria-label");
    expect(expanded_label).toBeTruthy();
    expect(tooltip?.textContent).toContain(expanded_label);
    expect(tooltip?.querySelector("kbd")?.textContent).toBe(get_shortcut_label("toggle_sidebar"));

    const input = document.createElement("input");
    container?.append(input);
    const input_event = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => input.dispatchEvent(input_event));
    expect(input_event.defaultPrevented).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    const shortcut = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button.dispatchEvent(shortcut));
    expect(shortcut.defaultPrevented).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).not.toBe(expanded_label);
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe(expanded_label);
  });
});
