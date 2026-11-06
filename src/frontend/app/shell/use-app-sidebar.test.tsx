import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  let is_wide: boolean;
  let query: MediaQueryList;

  beforeEach(() => {
    is_wide = false;
    vi.spyOn(window, "matchMedia").mockImplementation((media) => {
      query = Object.assign(new EventTarget(), { media }) as MediaQueryList;
      Object.defineProperty(query, "matches", { get: () => is_wide });
      return query;
    });
    window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  /** 模拟媒体查询只在跨断点时通知，区间内调整不发送事件。 */
  async function resize(next_is_wide: boolean): Promise<void> {
    const previous_is_wide = is_wide;
    is_wide = next_is_wide;
    await act(async () => {
      if (previous_is_wide !== is_wide) query.dispatchEvent(new Event("change"));
    });
  }

  /** 挂载一次壳层，模拟一次应用会话。 */
  async function mount(): Promise<void> {
    await act(async () => root.render(<Shell />));
  }

  /** 夹具始终提供一个侧栏切换按钮。 */
  function toggle_button(): HTMLButtonElement {
    return container.querySelector("button")!;
  }

  it.each([false, true])("未保存偏好时按宽区间 %s 初始化且不写入偏好", async (initial_is_wide) => {
    is_wide = initial_is_wide;
    await mount();
    expect(toggle_button().getAttribute("aria-expanded")).toBe(String(initial_is_wide));
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  it("手动展开跨会话保留，再收起后恢复自动切换", async () => {
    await mount();
    await act(async () => toggle_button().click());
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");
    await resize(true);
    await resize(false);
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");

    await act(async () => root.render(null));
    await mount();
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle_button().click());
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
    await resize(true);
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");
    await resize(false);
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
  });

  it("折叠偏好在启动与跨断点时自动切换，手动收起立即生效", async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
    is_wide = true;
    await mount();
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle_button().click());
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
    await resize(true);
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
    await resize(false);
    await resize(true);
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");
    await resize(false);
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");

    await resize(true);
    await act(async () => toggle_button().click());
    await act(async () => root.render(null));
    await mount();
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
  });

  it("卸载后移除宽度监听", async () => {
    await mount();
    const remove_listener = vi.spyOn(query, "removeEventListener");
    await act(async () => root.render(null));
    expect(remove_listener).toHaveBeenCalledExactlyOnceWith("change", expect.any(Function));
  });
});
