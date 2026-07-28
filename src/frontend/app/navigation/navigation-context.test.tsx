import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  AppNavigationProvider,
  useAppNavigation,
} from "@frontend/app/navigation/navigation-context";

function NavigationProbe(): JSX.Element {
  const navigation = useAppNavigation();
  return (
    <>
      <output>
        {navigation.selected_route}:{navigation.proofreading_lookup_intent?.keyword ?? "none"}
      </output>
      <button onClick={() => navigation.navigate_to_route("workbench")}>导航</button>
      <button
        onClick={() =>
          navigation.push_proofreading_lookup_intent({ keyword: "角色名", is_regex: false })
        }
      >
        查找
      </button>
      <button onClick={navigation.clear_proofreading_lookup_intent}>清除</button>
    </>
  );
}

describe("AppNavigationProvider", () => {
  it("暴露当前路由并维护校对查找意图", async () => {
    const navigate_to_route = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AppNavigationProvider selected_route="project-home" navigate_to_route={navigate_to_route}>
          <NavigationProbe />
        </AppNavigationProvider>,
      );
    });

    const buttons = container.querySelectorAll("button");
    await act(async () => buttons[0]?.click());
    expect(navigate_to_route).toHaveBeenCalledWith("workbench");

    await act(async () => buttons[1]?.click());
    expect(container.querySelector("output")?.textContent).toBe("project-home:角色名");

    await act(async () => buttons[2]?.click());
    expect(container.querySelector("output")?.textContent).toBe("project-home:none");

    await act(async () => root.unmount());
  });
});
