import { afterEach, describe, expect, it, vi } from "vitest";
import type React from "react";

// 入口测试只关心挂载顺序，ReactDOM mock 保留 createRoot/render 的真实调用边界。
const renderer_entry_mocks = vi.hoisted(() => {
  return {
    render: vi.fn(),
    createRoot: vi.fn(() => {
      return {
        render: renderer_entry_mocks.render,
      };
    }),
    install_renderer_global_error_handlers: vi.fn(),
  };
});

vi.mock("react-dom/client", () => {
  return {
    default: {
      createRoot: renderer_entry_mocks.createRoot,
    },
    createRoot: renderer_entry_mocks.createRoot,
  };
});

vi.mock("@frontend/app", () => {
  return {
    default: function AppMock(): null {
      return null;
    },
  };
});

vi.mock("@frontend/app/diagnostics/renderer-error-boundary", () => {
  return {
    RendererErrorBoundary: function RendererErrorBoundaryMock({
      children,
    }: {
      children: React.ReactNode;
    }): React.ReactNode {
      return children;
    },
  };
});

vi.mock("@frontend/app/diagnostics/renderer-error-reporter", () => {
  return {
    install_renderer_global_error_handlers:
      renderer_entry_mocks.install_renderer_global_error_handlers,
  };
});

describe("renderer index", () => {
  afterEach(() => {
    vi.resetModules();
    renderer_entry_mocks.render.mockClear();
    renderer_entry_mocks.createRoot.mockClear();
    renderer_entry_mocks.install_renderer_global_error_handlers.mockClear();
    document.body.innerHTML = "";
  });

  it("启动时先安装全局错误处理器，再挂载 React 根节点", async () => {
    const root_element = document.createElement("div");
    root_element.id = "root";
    document.body.append(root_element);

    await import("./index");

    expect(renderer_entry_mocks.install_renderer_global_error_handlers).toHaveBeenCalledOnce();
    expect(renderer_entry_mocks.createRoot).toHaveBeenCalledWith(root_element);
    expect(renderer_entry_mocks.render).toHaveBeenCalledOnce();
  });
});
