import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchLiveState } from "@/pages/workbench-page/use-workbench-live-state";

type RuntimeFixture = {
  align_project_runtime_ack: ReturnType<typeof vi.fn>;
  commit_local_project_patch: ReturnType<typeof vi.fn>;
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_store: {
    getState: () => {
      files: Record<string, unknown>;
      items: Record<string, unknown>;
    };
  };
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  workbench_change_signal: {
    seq: number;
  };
  refresh_task: ReturnType<typeof vi.fn>;
  settings_snapshot: Record<string, unknown>;
  set_project_snapshot: ReturnType<typeof vi.fn>;
  task_snapshot: {
    busy: boolean;
    task_type: string;
  };
};

type TranslationTaskRuntimeFixture = {
  translation_task_display_snapshot: null;
  translation_task_metrics: {
    active: boolean;
    stopping: boolean;
    processed_count: number;
    failed_count: number;
    completion_percent: number;
    average_output_speed: number;
    total_output_tokens: number;
  };
  translation_waveform_history: number[];
  task_confirm_state: null;
  open_translation_detail_sheet: ReturnType<typeof vi.fn>;
  close_translation_detail_sheet: ReturnType<typeof vi.fn>;
  request_start_or_continue_translation: ReturnType<typeof vi.fn>;
  request_task_action_confirmation: ReturnType<typeof vi.fn>;
  confirm_task_action: ReturnType<typeof vi.fn>;
  close_task_action_confirmation: ReturnType<typeof vi.fn>;
};

type AnalysisTaskRuntimeFixture = {
  analysis_task_display_snapshot: null;
  analysis_task_metrics: {
    active: boolean;
    stopping: boolean;
    processed_count: number;
    failed_count: number;
    completion_percent: number;
    average_output_speed: number;
    total_output_tokens: number;
  };
  analysis_waveform_history: number[];
  analysis_confirm_state: null;
  open_analysis_detail_sheet: ReturnType<typeof vi.fn>;
  close_analysis_detail_sheet: ReturnType<typeof vi.fn>;
  request_start_or_continue_analysis: ReturnType<typeof vi.fn>;
  request_analysis_task_action_confirmation: ReturnType<typeof vi.fn>;
  confirm_analysis_task_action: ReturnType<typeof vi.fn>;
  close_analysis_task_action_confirmation: ReturnType<typeof vi.fn>;
  request_import_analysis_glossary: ReturnType<typeof vi.fn>;
  refresh_analysis_task_snapshot: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const translation_runtime_fixture: { current: TranslationTaskRuntimeFixture } = {
  current: create_translation_task_runtime_fixture(),
};

const analysis_runtime_fixture: { current: AnalysisTaskRuntimeFixture } = {
  current: create_analysis_task_runtime_fixture(),
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/state/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/state/use-desktop-toast", () => {
  return {
    useDesktopToast: () => {
      return {
        push_toast: vi.fn(),
        run_modal_progress_toast: vi.fn(async (task: () => Promise<void>) => {
          await task();
        }),
      };
    },
  };
});

vi.mock("@/app/state/use-translation-task-runtime", () => {
  return {
    useTranslationTaskRuntime: () => translation_runtime_fixture.current,
  };
});

vi.mock("@/app/state/use-analysis-task-runtime", () => {
  return {
    useAnalysisTaskRuntime: () => analysis_runtime_fixture.current,
  };
});

vi.mock("@/i18n", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
      };
    },
  };
});

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

function create_runtime_fixture(): RuntimeFixture {
  return {
    align_project_runtime_ack: vi.fn(),
    commit_local_project_patch: vi.fn(() => {
      return {
        rollback: vi.fn(),
      };
    }),
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    project_store: {
      getState: () => {
        return {
          files: {},
          items: {},
        };
      },
    },
    refresh_project_runtime: vi.fn(async () => {}),
    workbench_change_signal: {
      seq: 0,
    },
    refresh_task: vi.fn(async () => {}),
    settings_snapshot: {},
    set_project_snapshot: vi.fn(),
    task_snapshot: {
      busy: false,
      task_type: "",
    },
  };
}

function create_translation_task_runtime_fixture(): TranslationTaskRuntimeFixture {
  return {
    translation_task_display_snapshot: null,
    translation_task_metrics: {
      active: false,
      stopping: false,
      processed_count: 0,
      failed_count: 0,
      completion_percent: 0,
      average_output_speed: 0,
      total_output_tokens: 0,
    },
    translation_waveform_history: [],
    task_confirm_state: null,
    open_translation_detail_sheet: vi.fn(),
    close_translation_detail_sheet: vi.fn(),
    request_start_or_continue_translation: vi.fn(async () => {}),
    request_task_action_confirmation: vi.fn(),
    confirm_task_action: vi.fn(async () => {}),
    close_task_action_confirmation: vi.fn(),
  };
}

function create_analysis_task_runtime_fixture(): AnalysisTaskRuntimeFixture {
  return {
    analysis_task_display_snapshot: null,
    analysis_task_metrics: {
      active: false,
      stopping: false,
      processed_count: 0,
      failed_count: 0,
      completion_percent: 0,
      average_output_speed: 0,
      total_output_tokens: 0,
    },
    analysis_waveform_history: [],
    analysis_confirm_state: null,
    open_analysis_detail_sheet: vi.fn(),
    close_analysis_detail_sheet: vi.fn(),
    request_start_or_continue_analysis: vi.fn(async () => {}),
    request_analysis_task_action_confirmation: vi.fn(),
    confirm_analysis_task_action: vi.fn(async () => {}),
    close_analysis_task_action_confirmation: vi.fn(),
    request_import_analysis_glossary: vi.fn(async () => {}),
    refresh_analysis_task_snapshot: vi.fn(async () => {}),
  };
}

describe("useWorkbenchLiveState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useWorkbenchLiveState> | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    runtime_fixture.current = create_runtime_fixture();
    translation_runtime_fixture.current = create_translation_task_runtime_fixture();
    analysis_runtime_fixture.current = create_analysis_task_runtime_fixture();
  });

  function WorkbenchProbe(): JSX.Element | null {
    latest_state = useWorkbenchLiveState();
    return null;
  }

  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(WorkbenchProbe));
    });
    await flush_async_updates();
  }

  it("项目路径切换后会先保持未 settled，直到收到工作台变更信号", async () => {
    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(latest_state?.cache_status).toBe("refreshing");
    expect(latest_state?.settled_project_path).toBe("");
    expect(latest_state?.entries).toEqual([]);
    expect(latest_state?.last_loaded_at).toBeNull();
  });

  it("收到本次 bootstrap 对应的工作台信号后才会落到 ready", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => {
          return {
            files: {
              "chapter01.txt": {
                rel_path: "chapter01.txt",
                file_type: "TXT",
                sort_index: 1,
              },
            },
            items: {
              "1": {
                item_id: 1,
                file_path: "chapter01.txt",
                status: "DONE",
              },
            },
          };
        },
      },
      workbench_change_signal: {
        seq: 1,
      },
    };

    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.settled_project_path).toBe("E:/demo/sample.lg");
    expect(latest_state?.entries).toHaveLength(1);
    expect(latest_state?.stats.total_items).toBe(1);
    expect(latest_state?.stats.completed_count).toBe(1);
    expect(latest_state?.entries.map((entry) => entry.rel_path)).toEqual(["chapter01.txt"]);
  });
});
