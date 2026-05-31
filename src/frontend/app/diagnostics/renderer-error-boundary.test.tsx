import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RendererErrorBoundary } from "@frontend/app/diagnostics/renderer-error-boundary";

// capture renderer error mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const capture_renderer_error_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/diagnostics/renderer-error-reporter", () => {
  return {
    capture_renderer_error: capture_renderer_error_mock,
  };
});

function BrokenChild(): JSX.Element {
  throw new Error("render boom");
}

describe("RendererErrorBoundary", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
    capture_renderer_error_mock.mockClear();
  });

  it("React 渲染异常会进入保护视图并写入 renderer 诊断", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <RendererErrorBoundary>
          <BrokenChild />
        </RendererErrorBoundary>,
      );
    });

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(capture_renderer_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "render boom",
      }),
      expect.objectContaining({
        source: "render",
      }),
    );
  });
});
