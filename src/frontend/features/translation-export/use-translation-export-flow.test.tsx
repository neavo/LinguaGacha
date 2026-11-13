import { type JSX, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { find_agent_reference_ranges } from "@shared/agent-reference";
import { useTranslationExportFlow } from "./use-translation-export-flow";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

const mocks = vi.hoisted(() => ({
  api_fetch: vi.fn(),
  workbench: vi.fn(),
  warnings: vi.fn(),
  push_toast: vi.fn(),
  navigate_to_agent: vi.fn(),
  project_snapshot: { loaded: true, file_count: 1, path: "E:/demo/sample.lg" },
  settings_snapshot: { translation_save_mode: "PROJECT", translation_fixed_path: "" },
}));

vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: (path: string, request: unknown) =>
    path === "/api/workbench/snapshot"
      ? mocks.workbench(request)
      : path === "/api/proofreading/query"
        ? mocks.warnings(request)
        : mocks.api_fetch(path, request),
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

/** 通过渲染提交后的公开返回值观察翻译成果导出流程。 */
function Probe(props: {
  on_ready: (flow: ReturnType<typeof useTranslationExportFlow>) => void;
}): JSX.Element | null {
  const flow = useTranslationExportFlow();
  useEffect(() => {
    props.on_ready(flow);
  }, [flow, props]);
  return null;
}

describe("useTranslationExportFlow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_flow: ReturnType<typeof useTranslationExportFlow> | null = null;

  beforeEach(() => {
    vi.stubGlobal("desktopApp", create_desktop_bridge_api_mock());
    mocks.api_fetch.mockReset();
    mocks.warnings.mockReset().mockResolvedValue({
      projectPath: "E:/demo/sample.lg",
      sectionRevisions: { files: 7 },
      warningCount: 0,
    });
    mocks.workbench.mockReset().mockResolvedValue({
      projectPath: "E:/demo/sample.lg",
      sectionRevisions: { files: 7 },
      snapshot: { entries: [{ file_type: "TXT", rel_path: "native.txt" }] },
    });
    mocks.push_toast.mockReset();
    mocks.navigate_to_agent.mockReset();
    mocks.project_snapshot.loaded = true;
    mocks.project_snapshot.file_count = 1;
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

  it.each([false, true])("警告先确认，格式范围需要独立下一步：%s", async (has_agent_files) => {
    mocks.settings_snapshot.translation_save_mode = "MANUAL";
    const pick = vi
      .spyOn(window.desktopApp, "pickDirectory")
      .mockResolvedValue({ canceled: false, paths: ["E:/chosen"] });
    mocks.warnings.mockResolvedValue({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 7 },
      warningCount: 3,
    });
    mocks.workbench.mockResolvedValue({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 7 },
      snapshot: {
        entries: [
          { file_type: "TXT", rel_path: "native.txt" },
          ...(has_agent_files ? [{ file_type: "MEDIA", rel_path: "movie.media" }] : []),
        ],
      },
    });
    mocks.api_fetch.mockResolvedValue({ accepted: true });
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    expect(latest_flow?.state).toMatchObject({
      phase: "ready",
      step: "warnings",
      warning_count: 3,
    });
    if (has_agent_files) {
      await act(async () => latest_flow?.confirm_export());
      expect(mocks.api_fetch).not.toHaveBeenCalled();
      act(() => {
        latest_flow?.next_step();
        latest_flow?.next_step();
      });
      expect(latest_flow?.state).toMatchObject({
        phase: "ready",
        step: "files",
        has_agent_files: true,
      });
      expect(mocks.api_fetch).not.toHaveBeenCalled();
      expect(pick).not.toHaveBeenCalled();
    }
    await act(async () => latest_flow?.confirm_export());
    expect(pick).toHaveBeenCalledOnce();
    expect(mocks.api_fetch).toHaveBeenCalledOnce();
    expect(mocks.warnings).toHaveBeenCalledExactlyOnceWith({ action: "warning_count" });
    pick.mockRestore();
  });

  it.each(["warnings", "files"])("在 %s 阶段转交 Agent 时预填对应任务", async (step) => {
    mocks.warnings.mockResolvedValue({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 7 },
      warningCount: 2,
    });
    mocks.workbench.mockResolvedValue({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 7 },
      snapshot: { entries: [{ file_type: "MEDIA", rel_path: "movie.media" }] },
    });
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    if (step === "files") act(() => latest_flow?.next_step());
    act(() => latest_flow?.jump_to_agent());
    const text = mocks.navigate_to_agent.mock.calls[0]![0].text;
    expect(
      find_agent_reference_ranges(text).some(({ reference }) => reference.kind === "skill"),
    ).toBe(true);
    // 审校只在 warnings 阶段显式出现，两条路径共用同一导出任务文案。
    expect(text.includes("app.agent_input.steps.review")).toBe(step === "warnings");
    expect(text).toContain('app.translation_export.agent_request @skill("project-operation")');
    expect(mocks.api_fetch).not.toHaveBeenCalled();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    expect(latest_flow?.state).toMatchObject({ phase: "ready", step: "warnings" });
  });

  it("警告检查失败或文件修订不一致时重新检查，拒绝绕过确认", async () => {
    mocks.warnings.mockRejectedValueOnce(new Error("warnings unavailable"));
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("check-failed");
    mocks.warnings.mockResolvedValueOnce({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 8 },
      warningCount: 0,
    });
    act(() => latest_flow?.retry_check());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("check-failed");
    await act(async () => latest_flow?.confirm_export());
    expect(mocks.api_fetch).not.toHaveBeenCalled();
    act(() => latest_flow?.retry_check());
    await flush_microtasks();
    expect(latest_flow?.state).toMatchObject({ phase: "ready", step: "files" });
  });

  it("空工程禁用入口，删除最后一个文件关闭确认", async () => {
    mocks.project_snapshot.file_count = 0;
    await render_probe();
    expect(latest_flow?.can_request_export).toBe(false);
    act(() => latest_flow?.request_export());
    expect(mocks.workbench).not.toHaveBeenCalled();
    mocks.project_snapshot.file_count = 1;
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("ready");
    mocks.project_snapshot.file_count = 0;
    await render_probe();
    expect(latest_flow?.state.phase).toBe("closed");
  });

  it.each(["GENERIC", "MEDIA", "IMAGE"])(
    "%s 文件报告范围，交给 Agent 只预填导出任务",
    async (file_type) => {
      mocks.warnings.mockResolvedValue({
        projectPath: mocks.project_snapshot.path,
        sectionRevisions: { files: 9 },
        warningCount: 0,
      });
      mocks.workbench.mockResolvedValue({
        projectPath: mocks.project_snapshot.path,
        sectionRevisions: { files: 9 },
        snapshot: {
          entries: [
            { file_type, rel_path: "asset" },
            { file_type: "TXT", rel_path: "native.txt" },
          ],
        },
      });
      await render_probe();
      act(() => latest_flow?.request_export());
      await flush_microtasks();
      expect(latest_flow?.state).toEqual({
        phase: "ready",
        step: "files",
        warning_count: 0,
        has_agent_files: true,
        has_supported_files: true,
        files_revision: 9,
      });
      expect(mocks.api_fetch).not.toHaveBeenCalled();
      act(() => latest_flow?.jump_to_agent());
      const text = mocks.navigate_to_agent.mock.calls[0]![0].text;
      expect(text).toContain("app.translation_export.agent_request");
      expect(
        find_agent_reference_ranges(text).some(({ reference }) => reference.kind === "skill"),
      ).toBe(true);
      expect(latest_flow?.state.phase).toBe("closed");
    },
  );

  it("仅 Agent 资产不能直接导出，空集合结束流程", async () => {
    mocks.workbench.mockResolvedValueOnce({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 7 },
      snapshot: { entries: [{ file_type: "MEDIA", rel_path: "video" }] },
    });
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    await act(async () => latest_flow?.confirm_export());
    expect(mocks.api_fetch).not.toHaveBeenCalled();
    act(() => latest_flow?.close());
    mocks.workbench.mockResolvedValueOnce({
      projectPath: mocks.project_snapshot.path,
      snapshot: { entries: [] },
    });
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("closed");
  });

  it("读取失败提供重试或转交 Agent，拒绝直接导出", async () => {
    mocks.workbench.mockRejectedValueOnce(new Error("files unavailable"));
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("check-failed");
    await act(async () => latest_flow?.confirm_export());
    expect(mocks.api_fetch).not.toHaveBeenCalled();
    act(() => latest_flow?.jump_to_agent());
    expect(mocks.navigate_to_agent).toHaveBeenCalledOnce();
    mocks.workbench.mockRejectedValueOnce(new Error("files unavailable"));
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    act(() => latest_flow?.retry_check());
    await flush_microtasks();
    expect(latest_flow?.state.phase).toBe("ready");
  });

  it.each(["close", "switch"])("%s 淘汰迟到查询", async (action) => {
    const pending = Promise.withResolvers<unknown>();
    mocks.workbench.mockReturnValueOnce(pending.promise);
    await render_probe();
    act(() => latest_flow?.request_export());
    if (action === "close") act(() => latest_flow?.close());
    else {
      mocks.project_snapshot.path = "other.lg";
      await render_probe();
    }
    await act(async () =>
      pending.resolve({
        projectPath: "E:/demo/sample.lg",
        sectionRevisions: { files: 7 },
        snapshot: { entries: [{ file_type: "TXT", rel_path: "native.txt" }] },
      }),
    );
    expect(latest_flow?.state.phase).toBe("closed");
  });

  it.each(["PROJECT", "FIXED", "MANUAL"])(
    "%s 模式携带确认修订，提交期间防止重复导出",
    async (mode) => {
      mocks.settings_snapshot.translation_save_mode = mode;
      const pick = vi
        .spyOn(window.desktopApp, "pickDirectory")
        .mockResolvedValue({ canceled: false, paths: ["E:/chosen"] });
      const pending = Promise.withResolvers<unknown>();
      mocks.api_fetch.mockReturnValueOnce(pending.promise);
      await render_probe();
      act(() => latest_flow?.request_export());
      await flush_microtasks();
      let exporting!: Promise<void>;
      await act(async () => {
        exporting = latest_flow!.confirm_export();
        void latest_flow?.confirm_export();
      });
      expect(mocks.api_fetch).toHaveBeenCalledExactlyOnceWith("/api/translation/files/generate", {
        project_path: mocks.project_snapshot.path,
        expected_section_revisions: { files: 7 },
        ...(mode === "MANUAL" ? { output_directory: "E:/chosen" } : {}),
      });
      expect(pick).toHaveBeenCalledTimes(mode === "MANUAL" ? 1 : 0);
      await act(async () => {
        pending.resolve({ accepted: true });
        await exporting;
      });
      expect(latest_flow?.state.phase).toBe("closed");
      pick.mockRestore();
    },
  );

  it("导出失败恢复确认，修订冲突重新读取范围", async () => {
    mocks.api_fetch
      .mockRejectedValueOnce(new Error("disk failed"))
      .mockRejectedValueOnce(new DesktopApiError({ code: "data.revision_conflict" }));
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    await act(async () => latest_flow?.confirm_export());
    expect(latest_flow?.state.phase).toBe("ready");
    expect(mocks.push_toast).toHaveBeenCalledOnce();
    mocks.warnings.mockResolvedValueOnce({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 8 },
      warningCount: 0,
    });
    mocks.workbench.mockResolvedValueOnce({
      projectPath: mocks.project_snapshot.path,
      sectionRevisions: { files: 8 },
      snapshot: { entries: [{ file_type: "MEDIA", rel_path: "new" }] },
    });
    await act(async () => latest_flow?.confirm_export());
    expect(latest_flow?.state).toMatchObject({
      phase: "ready",
      files_revision: 8,
      has_agent_files: true,
      has_supported_files: false,
    });
  });

  it("目录取消与工程切换淘汰旧提交", async () => {
    mocks.settings_snapshot.translation_save_mode = "MANUAL";
    const pick = vi
      .spyOn(window.desktopApp, "pickDirectory")
      .mockResolvedValueOnce({ canceled: true, paths: [] });
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    await act(async () => latest_flow?.confirm_export());
    expect(latest_flow?.state.phase).toBe("closed");
    const pending = Promise.withResolvers<{ canceled: boolean; paths: string[] }>();
    pick.mockReturnValueOnce(pending.promise);
    act(() => latest_flow?.request_export());
    await flush_microtasks();
    let exporting!: Promise<void>;
    act(() => {
      exporting = latest_flow!.confirm_export();
    });
    mocks.project_snapshot.path = "other.lg";
    await render_probe();
    await act(async () => {
      pending.resolve({ canceled: false, paths: ["E:/chosen"] });
      await exporting;
    });
    expect(mocks.api_fetch).not.toHaveBeenCalled();
    expect(latest_flow?.state.phase).toBe("closed");
    pick.mockRestore();
  });
});
