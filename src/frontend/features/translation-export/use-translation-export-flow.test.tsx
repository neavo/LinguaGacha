import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTranslationExportFlow } from "./use-translation-export-flow";

const mocks = vi.hoisted(() => ({
  api_fetch: vi.fn(),
  push_toast: vi.fn(),
  navigate_to_route: vi.fn(),
  write_draft: vi.fn(),
  project_snapshot: { loaded: true, path: "E:/demo/sample.lg" },
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api_fetch }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast: mocks.push_toast }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_route: mocks.navigate_to_route }),
}));
vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentInput: () => ({ write_draft: mocks.write_draft }),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: mocks.project_snapshot }),
}));

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
    mocks.api_fetch.mockReset();
    mocks.push_toast.mockReset();
    mocks.navigate_to_route.mockReset();
    mocks.write_draft.mockReset();
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

  async function render_probe(): Promise<void> {
    container ??= document.createElement("div");
    if (container.parentNode === null) document.body.append(container);
    root ??= createRoot(container);
    await act(async () => {
      root?.render(<Probe on_ready={(flow) => (latest_flow = flow)} />);
    });
  }

  async function flush_microtasks(): Promise<void> {
    await act(async () => Promise.resolve());
  }

  it("读取警告摘要后覆盖 AGENT 草稿并跳转", async () => {
    mocks.api_fetch.mockResolvedValueOnce({
      projectPath: "E:/demo/sample.lg",
      warningSummary: {
        total_count: 3,
        entries: [
          { code: "KANA", count: 1 },
          { code: "GLOSSARY", count: 2 },
        ],
      },
    });
    await render_probe();

    act(() => latest_flow?.request_export());
    expect(latest_flow?.state.phase).toBe("checking");
    await flush_microtasks();
    expect(latest_flow?.state).toMatchObject({ phase: "ready", summary: { total_count: 3 } });

    act(() => latest_flow?.jump_to_agent());
    expect(mocks.write_draft).toHaveBeenCalledWith({
      text: "agent_page.empty.suggestions.translation_workflow @skill(translation-workflow)",
      attachments: [],
    });
    expect(mocks.navigate_to_route).toHaveBeenCalledWith("agent");
    expect(latest_flow?.state.phase).toBe("closed");
  });

  it("无警告确认后只调用一次唯一导出接口", async () => {
    let resolve_export: (() => void) | null = null;
    mocks.api_fetch
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        warningSummary: { total_count: 0, entries: [] },
      })
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolve_export = resolve;
          }),
      );
    await render_probe();
    act(() => latest_flow?.request_export());
    await flush_microtasks();

    await act(async () => {
      void latest_flow?.confirm_export();
      void latest_flow?.confirm_export();
      await Promise.resolve();
    });
    expect(latest_flow?.state.phase).toBe("exporting");
    expect(mocks.api_fetch).toHaveBeenCalledWith("/api/translation/files/export", {});
    expect(
      mocks.api_fetch.mock.calls.filter(([path]) => path === "/api/translation/files/export"),
    ).toHaveLength(1);

    await act(async () => resolve_export?.());
    expect(latest_flow?.state.phase).toBe("closed");
  });

  it("警告查询失败后允许重新检查", async () => {
    mocks.api_fetch.mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({
      projectPath: "E:/demo/sample.lg",
      warningSummary: { total_count: 0, entries: [] },
    });
    await render_probe();

    act(() => latest_flow?.request_export());
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
    act(() => latest_flow?.request_export());

    mocks.project_snapshot.path = "E:/demo/next.lg";
    await render_probe();
    expect(latest_flow?.state.phase).toBe("closed");

    await act(async () => {
      resolve_summary?.({
        projectPath: "E:/demo/sample.lg",
        warningSummary: { total_count: 1, entries: [{ code: "KANA", count: 1 }] },
      });
    });
    expect(latest_flow?.state.phase).toBe("closed");
  });
});
