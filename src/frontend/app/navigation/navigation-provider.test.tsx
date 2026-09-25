import { type JSX, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { AppNavigationProvider } from "@frontend/app/navigation/navigation-provider";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";

/** 通过公开导航接口观察路由和跨页请求。 */
function NavigationProbe(): JSX.Element {
  const navigation = useAppNavigation();
  return (
    <>
      <output>
        {navigation.selected_route}:{navigation.proofreading_lookup_intent?.keyword ?? "none"}:
        {navigation.proofreading_lookup_intent?.scope ?? "none"}
      </output>
      <button onClick={() => navigation.navigate_to_route("workbench")}>导航</button>
      <button
        onClick={() =>
          navigation.push_proofreading_lookup_intent({
            keyword: "角色名",
            is_regex: false,
            scope: "src",
          })
        }
      >
        查找
      </button>
      <button onClick={navigation.clear_proofreading_lookup_intent}>清除</button>
      <button onClick={() => navigation.navigate_to_agent({ text: "安装技能", mode: "replace" })}>
        安装
      </button>
      <button onClick={navigation.clear_agent_input_request}>消费输入请求</button>
      <span>{navigation.agent_input_request?.text}</span>
    </>
  );
}

describe("AppNavigationProvider", () => {
  it("传递导航请求并维护校对查找意图", async () => {
    const navigate_to_route = vi.fn();
    const clear_agent_input_request = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AppNavigationProvider
          selected_route="project-home"
          navigate_to_route={navigate_to_route}
          agent_input_request={{ text: "审校请求", mode: "if-empty" }}
          clear_agent_input_request={clear_agent_input_request}
        >
          <NavigationProbe />
        </AppNavigationProvider>,
      );
    });

    const buttons = container.querySelectorAll("button");
    await act(async () => buttons[0]?.click());
    expect(navigate_to_route).toHaveBeenCalledWith("workbench");

    await act(async () => buttons[1]?.click());
    expect(container.querySelector("output")?.textContent).toBe("project-home:角色名:src");

    await act(async () => buttons[2]?.click());
    expect(container.querySelector("output")?.textContent).toBe("project-home:none:none");

    await act(async () => buttons[3]?.click());
    expect(navigate_to_route).toHaveBeenLastCalledWith("agent", {
      text: "安装技能",
      mode: "replace",
    });
    expect(container.querySelector("span")?.textContent).toBe("审校请求");
    await act(async () => buttons[4]?.click());
    expect(clear_agent_input_request).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });
});
