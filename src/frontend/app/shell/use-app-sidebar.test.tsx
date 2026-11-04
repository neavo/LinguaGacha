import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAppSidebar } from "./use-app-sidebar";

const SIDEBAR_STORAGE_KEY = "lg-sidebar-collapsed";

/** 通过 Hook 的公开状态和回调观察布局选择。 */
function Shell(): JSX.Element {
  const { is_sidebar_collapsed, on_open_change } = useAppSidebar();
  return (
    <button
      aria-expanded={!is_sidebar_collapsed}
      onClick={() => on_open_change(is_sidebar_collapsed)}
    >
      切换侧栏
    </button>
  );
}

describe("应用侧栏偏好", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  /** 挂载一次壳层，模拟一次应用会话。 */
  async function mount(): Promise<void> {
    await act(async () => root.render(<Shell />));
  }

  /** 夹具始终提供一个侧栏切换按钮。 */
  function toggle_button(): HTMLButtonElement {
    return container.querySelector("button")!;
  }

  it("未保存偏好时默认折叠", async () => {
    await mount();
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
  });

  it("手动展开跨会话保留", async () => {
    await mount();
    await act(async () => toggle_button().click());
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");

    await act(async () => root.render(null));
    await mount();
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");
  });
});
