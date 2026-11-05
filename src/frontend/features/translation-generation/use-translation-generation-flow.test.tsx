import { type JSX, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { find_agent_reference_ranges } from "@shared/agent-reference";
import { useTranslationGenerationFlow } from "./use-translation-generation-flow";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

const mocks = vi.hoisted(() => ({
  api_fetch: vi.fn(),
  workbench: vi.fn(),
  push_toast: vi.fn(),
  navigate_to_agent: vi.fn(),
  project_snapshot: { loaded: true, path: "E:/demo/sample.lg" },
  settings_snapshot: { translation_save_mode: "PROJECT", translation_fixed_path: "" },
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: (path: string, request: unknown) =>
    path === "/api/workbench/snapshot" ? mocks.workbench(request) : mocks.api_fetch(path, request),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.push_toast,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({
    navigate_to_agent: mocks.navigate_to_agent,
  }),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: mocks.project_snapshot,
    settings_snapshot: mocks.settings_snapshot,
  }),
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
    vi.stubGlobal("desktopApp", create_desktop_bridge_api_mock());
    mocks.api_fetch.mockReset();
    mocks.workbench
      .mockReset()
      .mockResolvedValue({ projectPath: "E:/demo/sample.lg", snapshot: { entries: [] } });
    mocks.push_toast.mockReset();
    mocks.navigate_to_agent.mockReset();
    mocks.project_snapshot.loaded = true;
    mocks.project_snapshot.path = "E:/demo/sample.lg";
    mocks.settings_snapshot.translation_save_mode = "PROJECT";
    mocks.settings_snapshot.translation_fixed_path = "";
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
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

  it.each([
    { total_count: 3, has_generic: false },
    { total_count: 2, has_generic: true },
    { total_count: 0, has_generic: true },
  ])(
    "预检 $total_count 条警告、通用资产 $has_generic 后按任务顺序交给 Agent",
    async ({ total_count, has_generic }) => {
      mocks.api_fetch.mockResolvedValue({
        projectPath: mocks.project_snapshot.path,
        warningSummary: { total_count, entries: [] },
      });
      mocks.workbench.mockResolvedValue({
        projectPath: mocks.project_snapshot.path,
        snapshot: {
          entries: has_generic ? [{ file_type: "GENERIC", rel_path: "renamed.txt" }] : [],
        },
      });
      await render_probe();
      act(() => latest_flow?.request_generation());
      expect(latest_flow?.state.phase).toBe("checking");
      await flush_microtasks();
      expect(latest_flow?.state).toMatchObject({ phase: "ready", has_generic });
      act(() => latest_flow?.jump_to_agent());
      const text = mocks.navigate_to_agent.mock.calls[0]![0].text as string;
      // 技能路由决定任务责任，提示语可独立调整。
      expect(find_agent_reference_ranges(text).map(({ reference }) => reference)).toEqual([
        ...(total_count > 0 ? [{ kind: "skill", name: "translation" }] : []),
        { kind: "skill", name: "project-operation" },
      ]);
      expect(latest_flow?.state.phase).toBe("closed");
    },
  );

  it("文件检查失败仍可继续生成，不推断通用包不存在", async () => {
    mocks.api_fetch
      .mockResolvedValueOnce({
        projectPath: mocks.project_snapshot.path,
        warningSummary: { total_count: 0, entries: [] },
      })
      .mockResolvedValueOnce({ accepted: true });
    mocks.workbench.mockRejectedValueOnce(new Error("files unavailable"));
    await render_probe();
    act(() => latest_flow?.request_generation());
    await flush_microtasks();
    expect(latest_flow?.state).toEqual({ phase: "check-failed" });
    await act(async () => latest_flow?.confirm_generation());
    expect(mocks.api_fetch).toHaveBeenLastCalledWith(
      "/api/translation/files/generate",
      expect.any(Object),
    );
    expect(latest_flow?.state.phase).toBe("closed");
  });

  it.each(["close", "switch"])("%s 后忽略迟到的文件检查", async (action) => {
    const pending = Promise.withResolvers<unknown>();
    mocks.api_fetch.mockResolvedValue({
      projectPath: mocks.project_snapshot.path,
      warningSummary: { total_count: 0, entries: [] },
    });
    mocks.workbench.mockReturnValue(pending.promise);
    await render_probe();
    act(() => latest_flow?.request_generation());
    if (action === "close") act(() => latest_flow?.close());
    else {
      mocks.project_snapshot.path = "E:/demo/next.lg";
      await render_probe();
    }
    await act(async () =>
      pending.resolve({
        projectPath: "E:/demo/sample.lg",
        snapshot: { entries: [{ file_type: "GENERIC" }] },
      }),
    );
    expect(latest_flow?.state.phase).toBe("closed");
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
    expect(mocks.api_fetch).toHaveBeenCalledWith("/api/translation/files/generate", {
      project_path: "E:/demo/sample.lg",
    });
    expect(
      mocks.api_fetch.mock.calls.filter(([path]) => path === "/api/translation/files/generate"),
    ).toHaveLength(1);

    await act(async () => resolve_generation?.());
    expect(latest_flow?.state.phase).toBe("closed");
    expect(mocks.push_toast).not.toHaveBeenCalled();
  });

  it.each(["PROJECT", "FIXED", "MANUAL"])("%s 模式使用确定的输出父目录", async (mode) => {
    mocks.settings_snapshot.translation_save_mode = mode;
    mocks.settings_snapshot.translation_fixed_path = "E:/fixed";
    const pick = vi
      .spyOn(window.desktopApp, "pickDirectory")
      .mockResolvedValue({ canceled: false, paths: ["E:/chosen"] });
    mocks.api_fetch
      .mockResolvedValueOnce({
        projectPath: mocks.project_snapshot.path,
        warningSummary: { total_count: 0, entries: [] },
      })
      .mockResolvedValueOnce({ accepted: true });
    await render_probe();
    act(() => latest_flow?.request_generation());
    await flush_microtasks();
    await act(async () => {
      await latest_flow?.confirm_generation();
    });
    expect(mocks.api_fetch).toHaveBeenLastCalledWith("/api/translation/files/generate", {
      project_path: "E:/demo/sample.lg",
      ...(mode === "MANUAL" ? { output_directory: "E:/chosen" } : {}),
    });
    expect(pick).toHaveBeenCalledTimes(mode === "MANUAL" ? 1 : 0);
    pick.mockRestore();
  });

  it("取消或工程切换后迟到的选择不会生成文件", async () => {
    mocks.settings_snapshot.translation_save_mode = "MANUAL";
    let resolve_pick!: (value: { canceled: boolean; paths: string[] }) => void;
    const pick = vi.spyOn(window.desktopApp, "pickDirectory").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_pick = resolve;
        }),
    );
    mocks.api_fetch.mockResolvedValue({
      projectPath: mocks.project_snapshot.path,
      warningSummary: { total_count: 0, entries: [] },
    });
    await render_probe();
    act(() => latest_flow?.request_generation());
    await flush_microtasks();
    let pending!: Promise<void>;
    act(() => {
      pending = latest_flow!.confirm_generation();
    });
    await act(async () => {
      resolve_pick({ canceled: true, paths: [] });
      await pending;
    });
    expect(latest_flow?.state.phase).toBe("closed");
    act(() => latest_flow?.request_generation());
    await flush_microtasks();
    act(() => {
      pending = latest_flow!.confirm_generation();
    });
    mocks.project_snapshot.path = "E:/demo/next.lg";
    await render_probe();
    await act(async () => {
      resolve_pick({ canceled: false, paths: ["E:/chosen"] });
      await pending;
    });
    expect(
      mocks.api_fetch.mock.calls.filter(([url]) => url === "/api/translation/files/generate"),
    ).toHaveLength(0);
    pick.mockRestore();
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
