import { type JSX, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTranslationGenerationFlow } from "./use-translation-generation-flow";

const mocks = vi.hoisted(() => ({
  api_fetch: vi.fn(),
  push_toast: vi.fn(),
  navigate_to_agent: vi.fn(),
  selected_route: "workbench",
  project_snapshot: { loaded: true, path: "E:/demo/sample.lg" },
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api_fetch }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.push_toast,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({
    navigate_to_agent: mocks.navigate_to_agent,
    selected_route: mocks.selected_route,
  }),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: mocks.project_snapshot }),
}));

/** 通过渲染提交后的公开返回值观察译文生成流程。 */
function Probe(props: {
  on_ready: (flow: ReturnType<typeof useTranslationGenerationFlow>) => void;
}): JSX.Element | null {
  const flow = useTranslationGenerationFlow();
  useEffect(() => {
    props.on_ready(flow);
  }, [flow, props]);
  return null;
}

describe("useTranslationGenerationFlow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_flow: ReturnType<typeof useTranslationGenerationFlow> | null = null;

  beforeEach(() => {
    mocks.api_fetch.mockReset();
    mocks.push_toast.mockReset();
    mocks.navigate_to_agent.mockReset();
    mocks.selected_route = "workbench";
    mocks.project_snapshot.loaded = true;
    mocks.project_snapshot.path = "E:/demo/sample.lg";
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    latest_flow = null;
  });

  /** 复用挂载实例，使项目切换经过真实 Hook 生命周期。 */
  async function render_probe(): Promise<void> {
    container ??= document.createElement("div");
    if (container.parentNode === null) document.body.append(container);
    root ??= createRoot(container);
    await act(async () => {
      root?.render(<Probe on_ready={(flow) => (latest_flow = flow)} />);
    });
  }

  /** 等待预检 Promise 的状态更新提交到 React。 */
  async function flush_microtasks(): Promise<void> {
    await act(async () => Promise.resolve());
  }

  it("读取警告摘要后提交仅填充空草稿的审校导航请求", async () => {
    mocks.api_fetch.mockResolvedValueOnce({
      projectPath: "E:/demo/sample.lg",
      warningSummary: {
        total_count: 3,
        entries: [{ code: "FOREIGN_CHAR_RESIDUE", count: 3 }],
      },
    });
    await render_probe();

    act(() => latest_flow?.request_generation());
    expect(latest_flow?.state.phase).toBe("checking");
    await flush_microtasks();
    expect(latest_flow?.state).toMatchObject({ phase: "ready", summary: { total_count: 3 } });

    act(() => latest_flow?.jump_to_agent());
    expect(mocks.navigate_to_agent).toHaveBeenCalledWith({
      text: expect.stringMatching(/\S+ @skill\([^)]+\)$/),
      mode: "if-empty",
    });
    expect(latest_flow?.state.phase).toBe("closed");
  });

  it("AGENT 页面隐藏重复导航", async () => {
    mocks.selected_route = "agent";
    await render_probe();
    expect(latest_flow?.can_jump_to_agent).toBe(false);
  });

  it("工程切换后，旧译文生成失败不会恢复旧确认框", async () => {
    let reject_generation = (_error: Error): void => undefined;
    mocks.api_fetch
      .mockResolvedValueOnce({
        projectPath: mocks.project_snapshot.path,
        warningSummary: { total_count: 0, entries: [] },
      })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            reject_generation = reject;
          }),
      );
    await render_probe();
    act(() => latest_flow?.request_generation());
    await flush_microtasks();
    let generating: Promise<void> | undefined;
    act(() => {
      generating = latest_flow?.confirm_generation();
    });
    mocks.project_snapshot.path = "E:/demo/next.lg";
    await render_probe();
    await act(async () => {
      reject_generation(new Error("old generation failed"));
      await generating;
    });
    expect(latest_flow?.state.phase).toBe("closed");
    expect(mocks.push_toast).not.toHaveBeenCalled();
  });

  it("无警告确认后只调用一次唯一译文生成接口", async () => {
    let resolve_generation: (() => void) | null = null;
    mocks.api_fetch
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        warningSummary: { total_count: 0, entries: [] },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolve_generation = () =>
              resolve({
                accepted: true,
                output_path: "output",
                pdf_files: [],
              });
          }),
      );
    await render_probe();
    act(() => latest_flow?.request_generation());
    await flush_microtasks();

    await act(async () => {
      void latest_flow?.confirm_generation();
      void latest_flow?.confirm_generation();
      await Promise.resolve();
    });
    expect(latest_flow?.state.phase).toBe("generating");
    expect(mocks.api_fetch).toHaveBeenCalledWith("/api/translation/files/generate", {});
    expect(
      mocks.api_fetch.mock.calls.filter(([path]) => path === "/api/translation/files/generate"),
    ).toHaveLength(1);

    await act(async () => resolve_generation?.());
    expect(latest_flow?.state.phase).toBe("closed");
    expect(mocks.push_toast).not.toHaveBeenCalled();
  });

  it("译文生成业务错误与传输失败共用失败提示并允许重试", async () => {
    const error = Object.assign(new Error("translation.generation_failed"), {
      name: "DesktopApiError",
      code: "translation.generation_failed",
      details: {},
    });
    mocks.api_fetch
      .mockResolvedValueOnce({
        projectPath: mocks.project_snapshot.path,
        warningSummary: { total_count: 0, entries: [] },
      })
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(new Error("transport failed"));
    await render_probe();
    act(() => latest_flow?.request_generation());
    await flush_microtasks();
    await act(async () => {
      await latest_flow?.confirm_generation();
    });
    expect(mocks.push_toast).toHaveBeenLastCalledWith(
      "app.translation_generation.log.failed",
      expect.any(Error),
    );
    expect(latest_flow?.state.phase).toBe("ready");
    await act(async () => {
      await latest_flow?.confirm_generation();
    });
    expect(mocks.push_toast).toHaveBeenLastCalledWith(
      "app.translation_generation.log.failed",
      expect.any(Error),
    );
    expect(latest_flow?.state.phase).toBe("ready");
  });

  it("警告查询失败后允许重新检查", async () => {
    mocks.api_fetch.mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({
      projectPath: "E:/demo/sample.lg",
      warningSummary: { total_count: 0, entries: [] },
    });
    await render_probe();

    act(() => latest_flow?.request_generation());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("check-failed");

    act(() => latest_flow?.retry_check());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("ready");
  });

  it("项目切换后忽略旧项目迟到的警告摘要", async () => {
    let resolve_summary: ((value: unknown) => void) | null = null;
    mocks.api_fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_summary = resolve;
        }),
    );
    await render_probe();
    act(() => latest_flow?.request_generation());

    mocks.project_snapshot.path = "E:/demo/next.lg";
    await render_probe();
    expect(latest_flow?.state.phase).toBe("closed");

    await act(async () => {
      resolve_summary?.({
        projectPath: "E:/demo/sample.lg",
        warningSummary: {
          total_count: 1,
          entries: [{ code: "FOREIGN_CHAR_RESIDUE", count: 1 }],
        },
      });
    });
    expect(latest_flow?.state.phase).toBe("closed");
  });
});
