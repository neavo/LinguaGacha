import { type JSX, act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectSessionUiStateProvider } from "./project-session-ui-state-provider";
import { useProjectSessionUiState } from "./project-session-ui-state-context";

const project = vi.hoisted(() => ({ loaded: true, path: "first.lg" }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: project }),
}));

it("同一项目保留页面状态，切换与关闭在子树渲染前清空旧值", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let state!: ReturnType<typeof useProjectSessionUiState>;
  /** 同时观察渲染期读值和提交后的共享写入口。 */
  function Probe(): JSX.Element {
    const current = useProjectSessionUiState();
    useEffect(() => {
      state = current;
    }, [current]);
    return <output>{current.get_page_ui_state<string>("quality:glossary") ?? "empty"}</output>;
  }
  /** 每次读取都经过真实 Provider 的项目身份处理。 */
  async function render(): Promise<void> {
    await act(async () =>
      root.render(
        <ProjectSessionUiStateProvider>
          <Probe />
        </ProjectSessionUiStateProvider>,
      ),
    );
  }
  try {
    await render();
    state.set_page_ui_state("quality:glossary", "苹果");
    await render();
    expect(container.textContent).toBe("苹果");
    project.path = "second.lg";
    await render();
    expect(container.textContent).toBe("empty");
    state.set_page_ui_state("quality:glossary", "梨");
    project.loaded = false;
    project.path = "";
    await render();
    expect(container.textContent).toBe("empty");
  } finally {
    await act(async () => root.unmount());
  }
});
