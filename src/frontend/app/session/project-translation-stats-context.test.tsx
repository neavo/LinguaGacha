import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTranslationStatsResponse } from "@shared/project-translation-stats";
import type { ProjectChangeSignal } from "@frontend/app/state/project-change-signal";
import {
  ProjectTranslationStatsProvider,
  useProjectTranslationStats,
} from "./project-translation-stats-context";

const fixture = vi.hoisted(() => ({
  project: { loaded: true, path: "E:/first.lg" },
  status: "ready",
  signal: { seq: 0, reason: "", updated_sections: [], results: [] } as ProjectChangeSignal,
  query: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: fixture.project,
    project_session_status: fixture.status,
  }),
  useProjectChangeSignal: () => fixture.signal,
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: fixture.query }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast: fixture.toast }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

/** 响应可独立指定工程，模拟前后端切换时序不同步。 */
function response(percent: number, path = fixture.project.path): ProjectTranslationStatsResponse {
  return {
    projectPath: path,
    stats: {
      total_items: 100,
      completed_count: percent,
      skipped_count: 0,
      failed_count: 0,
      pending_count: 100 - percent,
      completion_percent: percent,
    },
  };
}

/** 从公开 Hook 观察统计，让多个订阅者参与同一场景。 */
function Consumer(): JSX.Element {
  const stats = useProjectTranslationStats();
  return <output>{stats?.completion_percent ?? "pending"}</output>;
}

describe("共享工程翻译统计", () => {
  let root: Root;
  let container: HTMLDivElement;
  let requests: Array<{
    resolve: (value: ProjectTranslationStatsResponse) => void;
    reject: (error: Error) => void;
  }>;
  beforeEach(() => {
    fixture.project = { loaded: true, path: "E:/first.lg" };
    fixture.status = "ready";
    fixture.signal = { seq: 0, reason: "", updated_sections: [], results: [] };
    requests = [];
    fixture.query
      .mockReset()
      .mockImplementation(
        () =>
          new Promise<ProjectTranslationStatsResponse>((resolve, reject) =>
            requests.push({ resolve, reject }),
          ),
      );
    fixture.toast.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** 保持 Provider 实例，在同一挂载中推进工程和信号。 */
  async function render(): Promise<void> {
    await act(async () =>
      root.render(
        <ProjectTranslationStatsProvider>
          <Consumer />
          <Consumer />
        </ProjectTranslationStatsProvider>,
      ),
    );
  }
  /** 同时观察所有订阅者，确认共享结果一致。 */
  function values(): string[] {
    return [...container.querySelectorAll("output")].map((node) => node.textContent ?? "");
  }
  /** 发布变更信号时保留已发出的请求，验证串行补读。 */
  async function signal(
    seq: number,
    sections: ProjectChangeSignal["updated_sections"],
  ): Promise<void> {
    fixture.signal = { seq, reason: "test", updated_sections: sections, results: [] };
    await render();
  }

  it("多个消费者共用查询，相关变更在请求结束后合并补读", async () => {
    await render();
    expect(fixture.query).toHaveBeenCalledTimes(1);
    expect(fixture.query).toHaveBeenCalledWith("/api/project/translation-stats", {});
    expect(values()).toEqual(["pending", "pending"]);
    await act(async () => requests[0]!.resolve(response(80)));
    expect(values()).toEqual(["80", "80"]);
    await signal(1, ["quality"]);
    expect(fixture.query).toHaveBeenCalledTimes(1);
    await signal(2, ["items"]);
    await signal(3, ["items"]);
    await signal(4, ["items"]);
    expect(fixture.query).toHaveBeenCalledTimes(2);
    await act(async () => requests[1]!.resolve(response(90)));
    expect(values()).toEqual(["90", "90"]);
    expect(fixture.query).toHaveBeenCalledTimes(3);
    await act(async () => requests[2]!.resolve(response(95)));
    expect(values()).toEqual(["95", "95"]);
  });

  it("工程切换立即清空统计并丢弃旧工程迟到响应", async () => {
    await render();
    await act(async () => requests[0]!.resolve(response(80)));
    await signal(1, ["items"]);
    fixture.project = { loaded: true, path: "E:/second.lg" };
    await render();
    expect(values()).toEqual(["pending", "pending"]);
    await act(async () => requests[1]!.resolve(response(100, "E:/first.lg")));
    expect(values()).toEqual(["pending", "pending"]);
    await act(async () => requests[2]!.resolve(response(100, "E:/first.lg")));
    expect(values()).toEqual(["pending", "pending"]);
    await signal(2, ["items"]);
    await act(async () => requests[3]!.resolve(response(20)));
    expect(values()).toEqual(["20", "20"]);
  });

  it("同路径重新加载隔离旧请求，关闭后清空统计", async () => {
    await render();
    fixture.status = "warming";
    await render();
    fixture.status = "ready";
    await render();
    await act(async () => requests[0]!.resolve(response(100)));
    expect(values()).toEqual(["pending", "pending"]);
    await act(async () => requests[1]!.resolve(response(30)));
    expect(values()).toEqual(["30", "30"]);
    fixture.project = { loaded: false, path: "" };
    await render();
    expect(values()).toEqual(["pending", "pending"]);
  });

  it("读取失败保留有效统计并允许重试，旧工程的重试失效", async () => {
    await render();
    await act(async () => requests[0]!.resolve(response(80)));
    await signal(1, ["items"]);
    await act(async () => requests[1]!.reject(new Error("offline")));
    expect(values()).toEqual(["80", "80"]);
    expect(fixture.toast).toHaveBeenCalledOnce();
    const retry = fixture.toast.mock.calls[0]![2] as { onClick: () => void };
    await act(async () => retry.onClick());
    await act(async () => requests[2]!.resolve(response(90)));
    expect(values()).toEqual(["90", "90"]);
    fixture.project = { loaded: false, path: "" };
    await render();
    await act(async () => retry.onClick());
    expect(fixture.query).toHaveBeenCalledTimes(3);
  });
});
