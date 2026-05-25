import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkbenchTaskRuntimeProvider,
  useWorkbenchTaskRuntime,
} from "@/pages/workbench-page/task-runtime/workbench-task-runtime-context";
import type { AnalysisTaskRuntime } from "@/pages/workbench-page/task-runtime/use-analysis-task-runtime";
import type { TranslationTaskRuntime } from "@/pages/workbench-page/task-runtime/use-translation-task-runtime";

const task_runtime_mock = vi.hoisted(() => {
  return {
    translation_task_runtime: null as TranslationTaskRuntime | null,
    analysis_task_runtime: null as AnalysisTaskRuntime | null,
  };
});

vi.mock("@/app/session/project-session-context", () => {
  return {
    useProjectSessionBarrier: () => ({
      create_barrier_checkpoint: vi.fn(),
      wait_for_barrier: vi.fn(async () => {}),
    }),
  };
});

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/pages/workbench-page/task-runtime/use-translation-task-runtime", () => {
  return {
    useTranslationTaskRuntime: () => {
      if (task_runtime_mock.translation_task_runtime === null) {
        throw new Error("缺少翻译任务运行态夹具。");
      }

      return task_runtime_mock.translation_task_runtime;
    },
  };
});

vi.mock("@/pages/workbench-page/task-runtime/use-analysis-task-runtime", () => {
  return {
    useAnalysisTaskRuntime: () => {
      if (task_runtime_mock.analysis_task_runtime === null) {
        throw new Error("缺少分析任务运行态夹具。");
      }

      return task_runtime_mock.analysis_task_runtime;
    },
  };
});

vi.mock("@/pages/workbench-page/components/task-runtime/task-runtime-confirm-dialog", () => {
  return {
    TaskRuntimeConfirmDialog: (props: {
      view_model: { open: boolean; description: string; submitting: boolean } | null;
      on_confirm: () => Promise<void>;
      on_close: () => void;
    }) => {
      if (props.view_model === null || !props.view_model.open) {
        return null;
      }

      return (
        <button
          type="button"
          data-testid="task-confirm-dialog"
          data-description={props.view_model.description}
          data-submitting={String(props.view_model.submitting)}
          onClick={() => {
            void props.on_confirm();
          }}
        />
      );
    },
  };
});

vi.mock("@/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-dialog", () => {
  return {
    QualityRuleImportConfirmDialog: (props: {
      state: { open: boolean; duplicate_count: number; submitting: boolean };
      on_skip: () => Promise<void>;
      on_overwrite: () => Promise<void>;
      on_close: () => void;
    }) => {
      if (!props.state.open) {
        return null;
      }

      return (
        <button
          type="button"
          data-testid="quality-import-dialog"
          data-duplicate-count={String(props.state.duplicate_count)}
          data-submitting={String(props.state.submitting)}
          onClick={() => {
            void props.on_overwrite();
          }}
        />
      );
    },
  };
});

function create_translation_task_runtime_fixture(
  overrides: Partial<TranslationTaskRuntime> = {},
): TranslationTaskRuntime {
  return {
    translation_task_display_snapshot: null,
    translation_task_metrics: {
      active: false,
      stopping: false,
      completion_percent: 0,
      processed_count: 0,
      failed_count: 0,
      elapsed_seconds: 0,
      remaining_seconds: 0,
      average_output_speed: 0,
      input_tokens: 0,
      output_tokens: 0,
      request_in_flight_count: 0,
    },
    translation_waveform_history: [],
    translation_detail_sheet_open: false,
    task_confirm_state: null,
    translation_task_menu_disabled: false,
    translation_task_menu_busy: false,
    open_translation_detail_sheet: vi.fn(),
    close_translation_detail_sheet: vi.fn(),
    request_start_or_continue_translation: vi.fn(async () => {}),
    request_task_action_confirmation: vi.fn(),
    confirm_task_action: vi.fn(async () => {}),
    close_task_action_confirmation: vi.fn(),
    ...overrides,
  };
}

function create_analysis_task_runtime_fixture(
  overrides: Partial<AnalysisTaskRuntime> = {},
): AnalysisTaskRuntime {
  return {
    analysis_task_display_snapshot: null,
    analysis_task_metrics: {
      active: false,
      stopping: false,
      completion_percent: 0,
      processed_count: 0,
      failed_count: 0,
      elapsed_seconds: 0,
      remaining_seconds: 0,
      average_output_speed: 0,
      input_tokens: 0,
      output_tokens: 0,
      request_in_flight_count: 0,
      candidate_count: 0,
    },
    analysis_waveform_history: [],
    analysis_detail_sheet_open: false,
    analysis_confirm_state: null,
    analysis_import_confirm_state: {
      open: false,
      duplicate_count: 0,
      submitting: false,
    },
    analysis_importing: false,
    analysis_task_menu_disabled: false,
    analysis_task_menu_busy: false,
    open_analysis_detail_sheet: vi.fn(),
    close_analysis_detail_sheet: vi.fn(),
    request_start_or_continue_analysis: vi.fn(async () => {}),
    request_analysis_task_action_confirmation: vi.fn(),
    confirm_analysis_task_action: vi.fn(async () => {}),
    close_analysis_task_action_confirmation: vi.fn(),
    request_import_analysis_glossary: vi.fn(async () => {}),
    import_analysis_glossary_duplicate_skip: vi.fn(async () => {}),
    import_analysis_glossary_duplicate_overwrite: vi.fn(async () => {}),
    close_analysis_glossary_import_confirmation: vi.fn(),
    refresh_analysis_task_snapshot: vi.fn(async () => {}),
    ...overrides,
  };
}

function RuntimeProbe(props: {
  onRuntime: (runtime: {
    translation_task_runtime: TranslationTaskRuntime;
    analysis_task_runtime: AnalysisTaskRuntime;
  }) => void;
}): JSX.Element | null {
  props.onRuntime(useWorkbenchTaskRuntime());
  return null;
}

describe("WorkbenchTaskRuntimeProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    task_runtime_mock.translation_task_runtime = create_translation_task_runtime_fixture();
    task_runtime_mock.analysis_task_runtime = create_analysis_task_runtime_fixture();
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
    task_runtime_mock.translation_task_runtime = null;
    task_runtime_mock.analysis_task_runtime = null;
    vi.clearAllMocks();
  });

  async function render_provider(children: ReactNode): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<WorkbenchTaskRuntimeProvider>{children}</WorkbenchTaskRuntimeProvider>);
    });
  }

  it("不挂载工作台页面时仍会渲染翻译完成确认", async () => {
    task_runtime_mock.translation_task_runtime = create_translation_task_runtime_fixture({
      task_confirm_state: {
        kind: "generate-translation",
        open: true,
        submitting: false,
      },
    });

    await render_provider(<div data-testid="non-workbench-page" />);

    const dialog = container?.querySelector('[data-testid="task-confirm-dialog"]');
    expect(container?.querySelector('[data-testid="non-workbench-page"]')).not.toBeNull();
    expect(dialog?.getAttribute("data-description")).toBe(
      "workbench_page.translation_task.confirm.generate_description",
    );
  });

  it("向子节点暴露同一份常驻任务运行态", async () => {
    const observed_runtimes: Array<{
      translation_task_runtime: TranslationTaskRuntime;
      analysis_task_runtime: AnalysisTaskRuntime;
    }> = [];

    await render_provider(
      <RuntimeProbe onRuntime={(runtime) => observed_runtimes.push(runtime)} />,
    );

    expect(observed_runtimes.at(-1)?.translation_task_runtime).toBe(
      task_runtime_mock.translation_task_runtime,
    );
    expect(observed_runtimes.at(-1)?.analysis_task_runtime).toBe(
      task_runtime_mock.analysis_task_runtime,
    );
  });
});
