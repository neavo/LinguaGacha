import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@/app/desktop-api";
import type { AnalysisTaskSnapshot } from "@/pages/workbench-page/task-runtime/analysis-task-model";
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
      analysis?: Record<string, unknown>;
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
  analysis_task_display_snapshot: AnalysisTaskSnapshot | null;
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

type WorkbenchPickerFixture = {
  pickWorkbenchFilePath: ReturnType<typeof vi.fn>;
};

type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
  run_modal_progress_toast: ReturnType<typeof vi.fn>;
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

const workbench_picker_fixture: { current: WorkbenchPickerFixture } = {
  current: {
    pickWorkbenchFilePath: vi.fn(),
  },
};

const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "desktopApp", {
  value: workbench_picker_fixture.current,
  configurable: true,
});

vi.mock("@/app/runtime/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => {
      return toast_fixture.current;
    },
  };
});

vi.mock("@/pages/workbench-page/task-runtime/use-translation-task-runtime", () => {
  return {
    useTranslationTaskRuntime: () => translation_runtime_fixture.current,
  };
});

vi.mock("@/pages/workbench-page/task-runtime/use-analysis-task-runtime", () => {
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

function create_toast_fixture(): ToastFixture {
  return {
    push_toast: vi.fn(),
    run_modal_progress_toast: vi.fn(async (options: { task: () => Promise<void> }) => {
      await options.task();
    }),
  };
}

function create_project_store_state(items: Record<string, unknown>) {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {
      "old.txt": {
        rel_path: "old.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    },
    items,
    quality: {
      glossary: { entries: [], enabled: true, mode: "default", revision: 0 },
      pre_replacement: { entries: [], enabled: true, mode: "default", revision: 0 },
      post_replacement: { entries: [], enabled: true, mode: "default", revision: 0 },
      text_preserve: { entries: [], enabled: true, mode: "default", revision: 0 },
    },
    prompts: {
      translation: { text: "", enabled: true, revision: 0 },
      analysis: { text: "", enabled: true, revision: 0 },
    },
    analysis: {},
    proofreading: {
      revision: 0,
    },
    task: {},
    revisions: {
      projectRevision: 1,
      sections: {
        files: 1,
        items: 2,
        analysis: 3,
      },
    },
  };
}

function create_project_item(args: {
  item_id: number;
  src: string;
  dst: string;
}): Record<string, unknown> {
  return {
    item_id: args.item_id,
    file_path: "old.txt",
    row_number: args.item_id,
    src: args.src,
    dst: args.dst,
    name_dst: null,
    status: "PROCESSED",
    text_type: "NONE",
    retry_count: 0,
  };
}

function create_analysis_task_snapshot(
  overrides: Partial<AnalysisTaskSnapshot> = {},
): AnalysisTaskSnapshot {
  return {
    task_type: "analysis",
    status: "RUNNING",
    busy: true,
    request_in_flight_count: 1,
    line: 0,
    total_line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
    analysis_candidate_count: 0,
    ...overrides,
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
    toast_fixture.current = create_toast_fixture();
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockReset();
    vi.mocked(api_fetch).mockReset();
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
    expect(latest_state?.stats.completed_count).toBe(0);
    expect(latest_state?.stats.skipped_count).toBe(1);
    expect(latest_state?.stats.completion_percent).toBe(100);
    expect(latest_state?.entries.map((entry) => entry.rel_path)).toEqual(["chapter01.txt"]);
  });

  it("运行中翻译统计仍只按 ProjectStore.items.status 派生", async () => {
    translation_runtime_fixture.current = {
      ...translation_runtime_fixture.current,
      translation_task_metrics: {
        ...translation_runtime_fixture.current.translation_task_metrics,
        active: true,
        processed_count: 99,
        failed_count: 10,
        completion_percent: 88,
      },
    };
    analysis_runtime_fixture.current = {
      ...analysis_runtime_fixture.current,
      analysis_task_metrics: {
        ...analysis_runtime_fixture.current.analysis_task_metrics,
        active: true,
        processed_count: 77,
        failed_count: 6,
        completion_percent: 66,
      },
    };
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
                status: "PROCESSED",
              },
              "2": {
                item_id: 2,
                file_path: "chapter01.txt",
                status: "ERROR",
              },
              "3": {
                item_id: 3,
                file_path: "chapter01.txt",
                status: "NONE",
              },
              "4": {
                item_id: 4,
                file_path: "chapter01.txt",
                status: "RULE_SKIPPED",
              },
              "5": {
                item_id: 5,
                file_path: "chapter01.txt",
                status: "DONE",
              },
            },
            analysis: {
              status_summary: {
                total_line: 4,
                processed_line: 2,
                error_line: 1,
                line: 3,
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

    expect(latest_state?.stats).toMatchObject({
      total_items: 5,
      completed_count: 1,
      failed_count: 1,
      pending_count: 1,
      skipped_count: 2,
      completion_percent: 60,
    });

    act(() => {
      latest_state?.toggle_stats_mode();
    });

    expect(latest_state?.stats).toMatchObject({
      total_items: 5,
      completed_count: 2,
      failed_count: 1,
      pending_count: 1,
      skipped_count: 1,
      completion_percent: 60,
    });
  });

  it("运行中分析统计会优先使用分析任务快照展示", async () => {
    analysis_runtime_fixture.current = {
      ...analysis_runtime_fixture.current,
      analysis_task_display_snapshot: create_analysis_task_snapshot({
        total_line: 4,
        processed_line: 2,
        error_line: 1,
        line: 3,
      }),
      analysis_task_metrics: {
        ...analysis_runtime_fixture.current.analysis_task_metrics,
        active: true,
        processed_count: 2,
        failed_count: 1,
        completion_percent: 75,
      },
    };
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        task_type: "analysis",
      },
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
                src: "一",
                status: "NONE",
              },
              "2": {
                item_id: 2,
                file_path: "chapter01.txt",
                src: "二",
                status: "NONE",
              },
              "3": {
                item_id: 3,
                file_path: "chapter01.txt",
                src: "三",
                status: "NONE",
              },
              "4": {
                item_id: 4,
                file_path: "chapter01.txt",
                src: "四",
                status: "NONE",
              },
              "5": {
                item_id: 5,
                file_path: "chapter01.txt",
                src: "五",
                status: "RULE_SKIPPED",
              },
            },
            analysis: {
              status_summary: {
                total_line: 4,
                processed_line: 0,
                error_line: 0,
                line: 0,
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

    expect(latest_state?.stats_mode).toBe("analysis");
    expect(latest_state?.stats).toMatchObject({
      total_items: 5,
      completed_count: 2,
      failed_count: 1,
      pending_count: 1,
      skipped_count: 1,
      completion_percent: 60,
    });
    expect(latest_state?.analysis_stats).toMatchObject(latest_state?.stats ?? {});
  });

  it("分析任务快照无有效总量时会回退到 ProjectStore 分析统计", async () => {
    analysis_runtime_fixture.current = {
      ...analysis_runtime_fixture.current,
      analysis_task_display_snapshot: create_analysis_task_snapshot({
        total_line: 0,
        processed_line: 9,
        error_line: 1,
      }),
      analysis_task_metrics: {
        ...analysis_runtime_fixture.current.analysis_task_metrics,
        active: true,
      },
    };
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        task_type: "analysis",
      },
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
                src: "一",
                status: "NONE",
              },
              "2": {
                item_id: 2,
                file_path: "chapter01.txt",
                src: "二",
                status: "NONE",
              },
            },
            analysis: {
              status_summary: {
                total_line: 2,
                processed_line: 1,
                error_line: 0,
                line: 1,
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

    expect(latest_state?.analysis_stats).toMatchObject({
      total_items: 2,
      completed_count: 1,
      failed_count: 0,
      pending_count: 1,
      skipped_count: 0,
      completion_percent: 50,
    });
  });

  it("翻译统计会在 items 信号后继续按 ProjectStore 状态刷新", async () => {
    translation_runtime_fixture.current = {
      ...translation_runtime_fixture.current,
      translation_task_metrics: {
        ...translation_runtime_fixture.current.translation_task_metrics,
        active: true,
        processed_count: 99,
        failed_count: 10,
        completion_percent: 88,
      },
    };
    await render_hook();

    let item_status = "NONE";
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
                status: item_status,
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

    expect(latest_state?.translation_stats).toMatchObject({
      total_items: 1,
      completed_count: 0,
      failed_count: 0,
      pending_count: 1,
      skipped_count: 0,
      completion_percent: 0,
    });

    item_status = "PROCESSED";
    runtime_fixture.current = {
      ...runtime_fixture.current,
      workbench_change_signal: {
        seq: 2,
      },
    };

    await render_hook();

    expect(latest_state?.translation_stats).toMatchObject({
      total_items: 1,
      completed_count: 1,
      failed_count: 0,
      pending_count: 0,
      skipped_count: 0,
      completion_percent: 100,
    });
  });

  it("添加文件解析成功后会先打开继承确认", async () => {
    vi.mocked(api_fetch).mockResolvedValueOnce({
      target_rel_path: "new.txt",
      file_type: "TXT",
      parsed_items: [{ src: "hello", dst: "", row: 1 }],
    });
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file_from_path("E:/demo/new.txt");
    });

    expect(latest_state?.dialog_state.kind).toBe("inherit-add-file");
    expect(workbench_picker_fixture.current.pickWorkbenchFilePath).not.toHaveBeenCalled();
    expect(api_fetch).toHaveBeenCalledWith("/api/project/workbench/parse-file", {
      source_path: "E:/demo/new.txt",
    });
    expect(api_fetch).toHaveBeenCalledTimes(1);
  });

  it("选择器添加文件会委托到同一条按路径解析流程", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      path: "E:/demo/new.txt",
    });
    vi.mocked(api_fetch).mockResolvedValueOnce({
      target_rel_path: "new.txt",
      file_type: "TXT",
      parsed_items: [{ src: "hello", dst: "", row: 1 }],
    });
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file();
    });

    expect(latest_state?.dialog_state.kind).toBe("inherit-add-file");
    expect(api_fetch).toHaveBeenCalledWith("/api/project/workbench/parse-file", {
      source_path: "E:/demo/new.txt",
    });
  });

  it("拖拽失败提示会复用全局 drop warning 文案", async () => {
    await render_hook();

    act(() => {
      latest_state?.notify_add_file_drop_issue("multiple");
      latest_state?.notify_add_file_drop_issue("unavailable");
    });

    expect(toast_fixture.current.push_toast).toHaveBeenNthCalledWith(
      1,
      "warning",
      "app.drop.multiple_unavailable",
    );
    expect(toast_fixture.current.push_toast).toHaveBeenNthCalledWith(
      2,
      "warning",
      "app.drop.unavailable",
    );
  });

  it("选择不继承会直接提交 add-file", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      path: "E:/demo/new.txt",
    });
    vi.mocked(api_fetch)
      .mockResolvedValueOnce({
        target_rel_path: "new.txt",
        file_type: "TXT",
        parsed_items: [{ src: "hello", dst: "", row: 1 }],
      })
      .mockResolvedValueOnce({
        accepted: true,
        projectRevision: 2,
        sectionRevisions: {},
      });
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
      settings_snapshot: {
        source_language: "JA",
        mtool_optimizer_enable: false,
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file();
    });
    await act(async () => {
      await latest_state?.cancel_dialog();
    });

    expect(api_fetch).toHaveBeenLastCalledWith(
      "/api/project/workbench/add-file",
      expect.objectContaining({
        target_rel_path: "new.txt",
        parsed_items: [expect.objectContaining({ dst: "" })],
      }),
    );
  });

  it("选择继承且存在多候选时会直接提交最高频译文", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      path: "E:/demo/new.txt",
    });
    vi.mocked(api_fetch)
      .mockResolvedValueOnce({
        target_rel_path: "new.txt",
        file_type: "TXT",
        parsed_items: [{ src: "hello", dst: "", row: 1 }],
      })
      .mockResolvedValueOnce({
        accepted: true,
        projectRevision: 2,
        sectionRevisions: {},
      });
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () =>
          create_project_store_state({
            "1": create_project_item({ item_id: 1, src: "hello", dst: "甲" }),
            "2": create_project_item({ item_id: 2, src: "hello", dst: "乙" }),
            "3": create_project_item({ item_id: 3, src: "hello", dst: "甲" }),
          }),
      },
      settings_snapshot: {
        source_language: "JA",
        mtool_optimizer_enable: false,
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file();
    });
    await act(async () => {
      await latest_state?.confirm_dialog();
    });

    expect(latest_state?.dialog_state.kind).toBeNull();
    expect(api_fetch).toHaveBeenLastCalledWith(
      "/api/project/workbench/add-file",
      expect.objectContaining({
        target_rel_path: "new.txt",
        parsed_items: [expect.objectContaining({ src: "hello", dst: "甲" })],
      }),
    );
  });
});
