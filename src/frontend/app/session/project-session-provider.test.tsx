import { act, type JSX, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTranslationStatsResponse } from "@shared/project-translation-stats";
import type { ProjectChangeSignal } from "@frontend/app/state/project-change-signal";
import type { TranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";
import type { BatchTask } from "./batch-task/use-batch-task";
import { useProjectTranslationStats } from "./project-translation-stats-context";
import { useTranslationExport } from "./translation-export/translation-export-context";
import { ProjectSessionProvider } from "./project-session-provider";

const fixture = vi.hoisted(() => ({
  project: { loaded: true, file_count: 1, path: "E:/first.lg" },
  status: "ready" as "idle" | "warming" | "ready",
  signal: { seq: 0, reason: "", updated_sections: [], results: [] } as ProjectChangeSignal,
  query: vi.fn(),
  toast: vi.fn(),
  batch_task: null as BatchTask | null,
}));

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: fixture.project,
    project_session_status: fixture.status,
    settings_snapshot: { translation_save_mode: "PROJECT", translation_fixed_path: "" },
  }),
  useProjectChangeSignal: () => fixture.signal,
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: fixture.query }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: fixture.toast,
  push_toast: fixture.toast,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: vi.fn() }),
}));
vi.mock("./batch-task/batch-task-recovery-toast", () => ({
  BatchTaskRecoveryToast: () => null,
}));
vi.mock("./batch-task/use-batch-task", () => ({
  useBatchTask: () => fixture.batch_task!,
}));
vi.mock("@frontend/features/translation-export/translation-export-dialog", () => ({
  TranslationExportDialog: ({ state }: TranslationExportFlow) =>
    state.phase === "closed" ? null : <div data-testid="export-dialog" />,
}));

function create_batch_task_fixture(overrides: Partial<BatchTask> = {}): BatchTask {
  return {
    task_display_snapshot: null,
    task_metrics: {
      status: "idle",
      total: null,
      completion_percent: null,
      active: false,
      stopping: false,
      elapsed_seconds: 0,
      remaining_seconds: 0,
      average_generation_speed: 0,
      input_tokens: 0,
      reasoning_tokens: 0,
      output_tokens: 0,
      request_in_flight_count: 0,
    },
    task_waveform_history: [],
    task_detail_sheet_open: false,
    task_confirm_state: null,
    translation_action_blocked: false,
    open_task_detail_sheet: vi.fn(),
    close_task_detail_sheet: vi.fn(),
    request_start_or_continue_translation: vi.fn(async () => {}),
    request_task_action_confirmation: vi.fn(),
    confirm_task_action: vi.fn(async () => {}),
    close_task_action_confirmation: vi.fn(),
    ...overrides,
  };
}

function stats_response(
  percent: number,
  path = fixture.project.path,
): ProjectTranslationStatsResponse {
  return {
    projectPath: path,
    stats: {
      total_items: 100,
      completed_count: percent,
      skipped_count: 0,
      pending_count: 100 - percent,
      completion_percent: percent,
    },
  };
}

function StatsConsumer(): JSX.Element {
  const stats = useProjectTranslationStats();
  return <output>{stats?.completion_percent ?? "pending"}</output>;
}

function ExportEntry(): JSX.Element {
  const flow = useTranslationExport();
  return <button onClick={flow.request_export}>导出</button>;
}

describe("ProjectSessionProvider", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    fixture.project = { loaded: true, file_count: 1, path: "E:/first.lg" };
    fixture.status = "ready";
    fixture.signal = { seq: 0, reason: "", updated_sections: [], results: [] };
    fixture.batch_task = create_batch_task_fixture();
    fixture.query.mockReset().mockResolvedValue(stats_response(50));
    fixture.toast.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render_session(children: ReactNode): Promise<void> {
    await act(async () => root.render(<ProjectSessionProvider>{children}</ProjectSessionProvider>));
  }

  it("多个消费者共用统计查询，相关变更在请求结束后合并补读且切换工程丢弃旧响应", async () => {
    const requests: Array<{
      resolve: (value: ProjectTranslationStatsResponse) => void;
      reject: (error: Error) => void;
    }> = [];
    fixture.query.mockImplementation(
      () =>
        new Promise<ProjectTranslationStatsResponse>((resolve, reject) =>
          requests.push({ resolve, reject }),
        ),
    );
    const values = () =>
      [...container.querySelectorAll("output")].map((node) => node.textContent ?? "");

    await render_session(
      <>
        <StatsConsumer />
        <StatsConsumer />
      </>,
    );
    expect(fixture.query).toHaveBeenCalledTimes(1);
    await act(async () => requests[0]!.resolve(stats_response(80)));
    expect(values()).toEqual(["80", "80"]);

    fixture.signal = { seq: 1, reason: "test", updated_sections: ["quality"], results: [] };
    await render_session(
      <>
        <StatsConsumer />
        <StatsConsumer />
      </>,
    );
    expect(fixture.query).toHaveBeenCalledTimes(1);

    for (const seq of [2, 3, 4]) {
      fixture.signal = { seq, reason: "test", updated_sections: ["items"], results: [] };
      await render_session(
        <>
          <StatsConsumer />
          <StatsConsumer />
        </>,
      );
    }
    expect(fixture.query).toHaveBeenCalledTimes(2);
    await act(async () => requests[1]!.resolve(stats_response(90)));
    expect(fixture.query).toHaveBeenCalledTimes(3);

    fixture.project = { loaded: true, file_count: 1, path: "E:/second.lg" };
    await render_session(
      <>
        <StatsConsumer />
        <StatsConsumer />
      </>,
    );
    expect(values()).toEqual(["pending", "pending"]);
    await act(async () => requests[2]!.resolve(stats_response(100, "E:/first.lg")));
    expect(values()).toEqual(["pending", "pending"]);
    await act(async () => requests[3]!.resolve(stats_response(20)));
    expect(values()).toEqual(["20", "20"]);
  });

  it("统计读取失败保留有效值并允许重试，卸载后旧重试失效", async () => {
    const requests: Array<{
      resolve: (value: ProjectTranslationStatsResponse) => void;
      reject: (error: Error) => void;
    }> = [];
    fixture.query.mockImplementation(
      () =>
        new Promise<ProjectTranslationStatsResponse>((resolve, reject) =>
          requests.push({ resolve, reject }),
        ),
    );
    await render_session(<StatsConsumer />);
    await act(async () => requests[0]!.resolve(stats_response(80)));
    fixture.signal = { seq: 1, reason: "test", updated_sections: ["items"], results: [] };
    await render_session(<StatsConsumer />);
    await act(async () => requests[1]!.reject(new Error("offline")));
    expect(container.textContent).toBe("80");
    expect(fixture.toast).toHaveBeenCalledOnce();
    const retry = fixture.toast.mock.calls[0]![2] as { action: { onClick: () => void } };
    await act(async () => retry.action.onClick());
    await act(async () => requests[2]!.resolve(stats_response(90)));
    expect(container.textContent).toBe("90");
    fixture.project = { loaded: false, file_count: 0, path: "" };
    await render_session(<StatsConsumer />);
    await act(async () => retry.action.onClick());
    expect(fixture.query).toHaveBeenCalledTimes(3);
  });

  it("多个入口共享一次翻译成果导出预检和确认弹窗", async () => {
    fixture.query.mockImplementation(async (url: string) =>
      url === "/api/project/translation-stats"
        ? stats_response(100)
        : {
            projectPath: "E:/first.lg",
            snapshot: { entries: [{ file_type: "TXT" }] },
            sectionRevisions: { files: 0 },
            warningCount: 0,
          },
    );
    await render_session(
      <>
        <ExportEntry />
        <ExportEntry />
      </>,
    );
    await act(async () => {
      for (const button of container.querySelectorAll("button")) button.click();
    });
    expect(container.querySelectorAll('[data-testid="export-dialog"]')).toHaveLength(1);
    await render_session(<ExportEntry />);
    expect(container.querySelectorAll('[data-testid="export-dialog"]')).toHaveLength(1);
  });

  it.each([
    ["reset-all", true],
    ["stop-translation", false],
  ] as const)("批量任务确认弹窗 %s 遵循译文清空倒计时保护", async (kind, delayed) => {
    vi.useFakeTimers();
    const task = fixture.batch_task!;
    task.task_confirm_state = { kind, submitting: false };
    await render_session(null);
    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-primary-action"]',
    )!;
    await act(async () => confirm.click());
    if (delayed) {
      expect(task.confirm_task_action).not.toHaveBeenCalled();
      await act(async () =>
        vi.advanceTimersByTime(Number.parseInt(confirm.textContent!, 10) * 1_000),
      );
      await act(async () => confirm.click());
    }
    expect(task.confirm_task_action).toHaveBeenCalledOnce();
  });

  it("任务详情面板随工程会话挂载并共享停止动作", async () => {
    const task = fixture.batch_task!;
    task.task_detail_sheet_open = true;
    task.task_metrics.active = true;
    task.task_metrics.total = 10;
    task.task_metrics.completion_percent = 25;
    await render_session(<div>Agent 页面</div>);
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("25.00%");
    const stop = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("batch_translation.action.stop"),
    );
    await act(async () => stop?.click());
    expect(task.request_task_action_confirmation).toHaveBeenCalledWith("stop-translation");
  });
});
