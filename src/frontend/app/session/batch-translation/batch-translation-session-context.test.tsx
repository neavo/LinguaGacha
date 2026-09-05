import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BatchTranslationSessionProvider,
  useBatchTranslationSession,
} from "@frontend/app/session/batch-translation/batch-translation-session-context";

import type { BatchTranslationTask } from "@frontend/app/session/batch-translation/use-batch-translation-task";
import type { TranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";

const task_runtime_mock = vi.hoisted(() => {
  return {
    batch_translation_task: null as BatchTranslationTask | null,

    translation_export: null as TranslationExportFlow | null,
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/app/session/batch-translation/use-batch-translation-task", () => {
  return {
    useBatchTranslationTask: (_options: { onRequestExport: () => void }) => {
      if (task_runtime_mock.batch_translation_task === null) {
        throw new Error("缺少翻译任务运行态夹具。");
      }

      return task_runtime_mock.batch_translation_task;
    },
  };
});

vi.mock("@frontend/features/translation-export/use-translation-export-flow", () => {
  return {
    useTranslationExportFlow: () => {
      if (task_runtime_mock.translation_export === null) {
        throw new Error("缺少译文导出流程夹具。");
      }
      return task_runtime_mock.translation_export;
    },
  };
});

vi.mock("@frontend/features/translation-export/translation-export-dialog", () => {
  return {
    TranslationExportDialog: (props: TranslationExportFlow) => {
      return props.state.phase === "closed" ? null : (
        <div data-testid="translation-export-dialog" />
      );
    },
  };
});

vi.mock("@frontend/widgets/app-alert-dialog", () => {
  return {
    AppConfirmDialog: (props: {
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

function create_batch_translation_task_fixture(
  overrides: Partial<BatchTranslationTask> = {},
): BatchTranslationTask {
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
      average_generation_speed: 0,
      input_tokens: 0,
      reasoning_tokens: 0,
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

function create_translation_export_fixture(
  overrides: Partial<TranslationExportFlow> = {},
): TranslationExportFlow {
  return {
    state: { phase: "closed" },
    can_request_export: true,
    request_export: vi.fn(),
    retry_check: vi.fn(),
    confirm_export: vi.fn(async () => {}),
    jump_to_agent: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function StateProbe(props: {
  onState: (state: {
    batch_translation_task: BatchTranslationTask;

    translation_export: TranslationExportFlow;
  }) => void;
}): JSX.Element | null {
  props.onState(useBatchTranslationSession());
  return null;
}

describe("BatchTranslationSessionProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    task_runtime_mock.batch_translation_task = create_batch_translation_task_fixture();

    task_runtime_mock.translation_export = create_translation_export_fixture();
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
    task_runtime_mock.batch_translation_task = null;

    task_runtime_mock.translation_export = null;
  });

  async function render_provider(children: ReactNode): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<BatchTranslationSessionProvider>{children}</BatchTranslationSessionProvider>);
    });
  }

  it("不挂载工作台页面时仍会渲染统一译文导出确认", async () => {
    task_runtime_mock.translation_export = create_translation_export_fixture({
      state: { phase: "ready", summary: { total_count: 0, entries: [] } },
    });

    await render_provider(<div data-testid="non-workbench-page" />);

    const dialog = container?.querySelector('[data-testid="translation-export-dialog"]');
    expect(container?.querySelector('[data-testid="non-workbench-page"]')).not.toBeNull();
    expect(dialog).not.toBeNull();
  });

  it("任务侧栏随 session 挂载，页面切换继续显示并使用共享停止动作", async () => {
    const task = task_runtime_mock.batch_translation_task!;
    task.translation_detail_sheet_open = true;
    task.translation_task_metrics.active = true;
    task.translation_task_metrics.completion_percent = 25;
    await render_provider(<div>Agent 页面</div>);
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("25.00%");
    await act(async () =>
      root?.render(
        <BatchTranslationSessionProvider>
          <div>工作台页面</div>
        </BatchTranslationSessionProvider>,
      ),
    );
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const stop = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("batch_translation.action.stop"),
    );
    await act(async () => stop?.click());
    expect(task.request_task_action_confirmation).toHaveBeenCalledWith("stop-translation");
  });

  it("向子节点暴露同一份常驻任务运行态", async () => {
    const observed_states: Array<{
      batch_translation_task: BatchTranslationTask;

      translation_export: TranslationExportFlow;
    }> = [];

    await render_provider(<StateProbe onState={(state) => observed_states.push(state)} />);

    expect(observed_states.at(-1)?.batch_translation_task).toBe(
      task_runtime_mock.batch_translation_task,
    );

    expect(observed_states.at(-1)?.translation_export).toBe(task_runtime_mock.translation_export);
  });
});
