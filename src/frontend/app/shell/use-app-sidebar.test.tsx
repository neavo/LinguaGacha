import { act, StrictMode, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RouteId } from "@frontend/app/navigation/types";
import { useAppSidebar } from "./use-app-sidebar";

const SIDEBAR_STORAGE_KEY = "lg-sidebar-collapsed";

/** 通过 Hook 的公开状态和回调观察布局选择。 */
function Shell({ route }: { route: RouteId }): JSX.Element {
  const { is_sidebar_collapsed, on_open_change } = useAppSidebar(route);
  return (
    <button
      aria-expanded={!is_sidebar_collapsed}
      onClick={() => on_open_change(is_sidebar_collapsed)}
    >
      切换侧栏
    </button>
  );
}

describe("应用侧栏策略", () => {
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
    container.remove();
    window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  });

  /** 复用壳层实例，验证实际页面变化与同页重渲染。 */
  async function navigate(route: RouteId): Promise<void> {
    await act(async () =>
      root.render(
        <StrictMode>
          <Shell route={route} />
        </StrictMode>,
      ),
    );
  }

  /** 夹具始终提供一个侧栏切换按钮。 */
  function toggle_button(): HTMLButtonElement {
    return container.querySelector("button")!;
  }

  it.each([false, true])("进入 Agent 临时折叠，离开恢复偏好（原先折叠：%s）", async (collapsed) => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    await navigate("workbench");
    expect(toggle_button().getAttribute("aria-expanded")).toBe(String(!collapsed));

    await navigate("agent");
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe(String(collapsed));

    await navigate("proofreading");
    expect(toggle_button().getAttribute("aria-expanded")).toBe(String(!collapsed));
  });

  it.each([false, true])(
    "Agent 手动选择更新全局偏好并跨会话恢复（选择折叠：%s）",
    async (collapsed) => {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!collapsed));
      await navigate("agent");
      expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
      await act(async () => toggle_button().click());
      if (collapsed) await act(async () => toggle_button().click());
      expect(toggle_button().getAttribute("aria-expanded")).toBe(String(!collapsed));
      expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe(String(collapsed));

      await navigate("workbench");
      expect(toggle_button().getAttribute("aria-expanded")).toBe(String(!collapsed));
      await act(async () => root.render(null));
      await navigate("project-home");
      expect(toggle_button().getAttribute("aria-expanded")).toBe(String(!collapsed));
    },
  );

  it("同页重渲染保留手动展开，离开后再次进入 Agent 重新折叠", async () => {
    await navigate("agent");
    await act(async () => toggle_button().click());
    await navigate("agent");
    expect(toggle_button().getAttribute("aria-expanded")).toBe("true");

    await navigate("workbench");
    await navigate("agent");
    expect(toggle_button().getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");
  });
});
