import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { ProjectSessionProvider } from "./project-session-context";

describe("project-session-context", () => {
  it("保持应用组合层入口并直接渲染子节点", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;

    act(() => {
      root = createRoot(container);
      root.render(
        <ProjectSessionProvider>
          <span>项目页面</span>
        </ProjectSessionProvider>,
      );
    });

    expect(container.textContent).toBe("项目页面");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
});
