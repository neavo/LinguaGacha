import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatchTaskSessionProvider } from "@frontend/app/session/batch-task/batch-task-session-provider";

import type { BatchTask } from "@frontend/app/session/batch-task/use-batch-task";

const task_runtime_mock = vi.hoisted(() => {
  return {
    batch_task: null as BatchTask | null,

    request_generation: vi.fn(),
  };
});

vi.mock("./batch-task-recovery-toast", () => ({
  BatchTaskRecoveryToast: () => null,
}));

vi.mock("@frontend/app/locale/locale-context", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/app/session/batch-task/use-batch-task", () => {
  return {
    useBatchTask: (_options: { onRequestGeneration: () => void }) => {
      if (task_runtime_mock.batch_task === null) {
        throw new Error("缺少翻译任务运行态夹具。");
      }

      return task_runtime_mock.batch_task;
    },
  };
});

vi.mock("@frontend/app/session/translation-generation/translation-generation-context", () => ({
  useTranslationGeneration: () => ({ request_generation: task_runtime_mock.request_generation }),
}));

/** 隔离后台任务，测试常驻侧栏的组合与回调。 */
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
    translation_task_menu_disabled: false,
    translation_task_menu_busy: false,
    open_task_detail_sheet: vi.fn(),
    close_task_detail_sheet: vi.fn(),
    request_start_or_continue_translation: vi.fn(async () => {}),
    request_task_action_confirmation: vi.fn(),
    confirm_task_action: vi.fn(async () => {}),
    close_task_action_confirmation: vi.fn(),
    ...overrides,
  };
}

vi.mock("@frontend/app/session/project-translation-stats-context", () => ({
  useProjectTranslationStats: () => ({ completion_percent: 80 }),
}));

describe("BatchTaskSessionProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    task_runtime_mock.batch_task = create_batch_task_fixture();

    task_runtime_mock.request_generation.mockClear();
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    task_runtime_mock.batch_task = null;
    vi.useRealTimers();
  });

  /** 用页面替换观察 session 的持续挂载。 */
  async function render_provider(children: ReactNode): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<BatchTaskSessionProvider>{children}</BatchTaskSessionProvider>);
    });
  }

  it.each([
    ["reset-all", true],
    ["stop-translation", false],
  ] as const)("%s 的确认受理遵循译文清空保护", async (kind, delayed) => {
    vi.useFakeTimers();
    const task = task_runtime_mock.batch_task!;
    task.task_confirm_state = { kind, submitting: false };
    await render_provider(null);
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

  it("零目标沿用空状态，不展开统计区域", async () => {
    const task = task_runtime_mock.batch_task!;
    task.task_detail_sheet_open = true;
    task.task_metrics.total = 0;
    await render_provider(null);
    expect(document.body.textContent).toContain("batch_translation.summary.empty");
    expect(document.querySelector(".batch-translation__metrics-grid")).toBeNull();
  });

  it("任务侧栏随 session 挂载，页面切换继续显示并使用共享停止动作", async () => {
    const task = task_runtime_mock.batch_task!;
    task.task_detail_sheet_open = true;
    task.task_metrics.active = true;
    task.task_metrics.completion_percent = 25;
    await render_provider(<div>Agent 页面</div>);
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () =>
      root?.render(
        <BatchTaskSessionProvider>
          <div>工作台页面</div>
        </BatchTaskSessionProvider>,
      ),
    );
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("25.00%");
    const stop = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("batch_translation.action.stop"),
    );
    await act(async () => stop?.click());
    expect(task.request_task_action_confirmation).toHaveBeenCalledWith("stop-translation");
  });
});
