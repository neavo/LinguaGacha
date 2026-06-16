import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkbenchTasksSessionProvider,
  useWorkbenchTasksSession,
} from "@frontend/app/session/workbench-tasks/workbench-tasks-session-context";
import type { AnalysisWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-analysis-workbench-task";
import type { TranslationWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-translation-workbench-task";

const task_runtime_mock = vi.hoisted(() => {
  return {
    translation_workbench_task: null as TranslationWorkbenchTask | null,
    analysis_workbench_task: null as AnalysisWorkbenchTask | null,
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/app/session/workbench-tasks/use-translation-workbench-task", () => {
  return {
    useTranslationWorkbenchTask: () => {
      if (task_runtime_mock.translation_workbench_task === null) {
        throw new Error("缺少翻译任务运行态夹具。");
      }

      return task_runtime_mock.translation_workbench_task;
    },
  };
});

vi.mock("@frontend/app/session/workbench-tasks/use-analysis-workbench-task", () => {
  return {
    useAnalysisWorkbenchTask: () => {
      if (task_runtime_mock.analysis_workbench_task === null) {
        throw new Error("缺少分析任务运行态夹具。");
      }

      return task_runtime_mock.analysis_workbench_task;
    },
  };
});

vi.mock("@frontend/widgets/app-alert-dialog", () => {
  return {
    AppAlertDialog: (props: {
      open: boolean;
      description: string;
      submitting: boolean;
      onConfirm: () => Promise<void>;
      onClose: () => void;
    }) => {
      if (!props.open) {
        return null;
      }

      return (
        <button
          type="button"
          data-testid="task-confirm-dialog"
          data-description={props.description}
          data-submitting={String(props.submitting)}
          onClick={() => {
            void props.onConfirm();
          }}
        />
      );
    },
  };
});

vi.mock(
  "@frontend/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-dialog",
  () => {
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
  },
);

function create_translation_workbench_task_fixture(
  overrides: Partial<TranslationWorkbenchTask> = {},
): TranslationWorkbenchTask {
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

function create_analysis_workbench_task_fixture(
  overrides: Partial<AnalysisWorkbenchTask> = {},
): AnalysisWorkbenchTask {
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
    import_analysis_glossary_duplicate_skip: vi.fn(async () => {}),
    import_analysis_glossary_duplicate_overwrite: vi.fn(async () => {}),
    close_analysis_glossary_import_confirmation: vi.fn(),
    refresh_analysis_task_snapshot: vi.fn(async () => {}),
    ...overrides,
  };
}

function StateProbe(props: {
  onState: (state: {
    translation_workbench_task: TranslationWorkbenchTask;
    analysis_workbench_task: AnalysisWorkbenchTask;
  }) => void;
}): JSX.Element | null {
  props.onState(useWorkbenchTasksSession());
  return null;
}

describe("WorkbenchTasksSessionProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    task_runtime_mock.translation_workbench_task = create_translation_workbench_task_fixture();
    task_runtime_mock.analysis_workbench_task = create_analysis_workbench_task_fixture();
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
    task_runtime_mock.translation_workbench_task = null;
    task_runtime_mock.analysis_workbench_task = null;
    vi.clearAllMocks();
  });

  async function render_provider(children: ReactNode): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<WorkbenchTasksSessionProvider>{children}</WorkbenchTasksSessionProvider>);
    });
  }

  it("不挂载工作台页面时仍会渲染翻译完成确认", async () => {
    task_runtime_mock.translation_workbench_task = create_translation_workbench_task_fixture({
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
    const observed_states: Array<{
      translation_workbench_task: TranslationWorkbenchTask;
      analysis_workbench_task: AnalysisWorkbenchTask;
    }> = [];

    await render_provider(<StateProbe onState={(state) => observed_states.push(state)} />);

    expect(observed_states.at(-1)?.translation_workbench_task).toBe(
      task_runtime_mock.translation_workbench_task,
    );
    expect(observed_states.at(-1)?.analysis_workbench_task).toBe(
      task_runtime_mock.analysis_workbench_task,
    );
  });
});
