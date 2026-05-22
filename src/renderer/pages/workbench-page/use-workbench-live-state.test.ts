import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProjectItemPublicRecord } from "@base/item";
import type { AnalysisTaskSnapshot } from "@/pages/workbench-page/task-runtime/analysis-task-model";
import { useWorkbenchLiveState } from "@/pages/workbench-page/use-workbench-live-state";
import { createProjectItemIndex, type ProjectItemIndex } from "@/project/store/project-item-index";
import type { DesktopPathPickResult } from "@gui/bridge-types";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

type RuntimeFixture = {
  apply_project_mutation_result: ReturnType<typeof vi.fn>;
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_store: {
    getState: () => {
      files: Record<string, unknown>;
      items: ProjectItemIndex;
      analysis?: Record<string, unknown>;
    };
  };
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  workbench_change_signal: {
    seq: number;
  };
  refresh_task: ReturnType<typeof vi.fn>;
  settings_snapshot: Record<string, unknown>;
  refresh_project_snapshot: ReturnType<typeof vi.fn>;
  sync_task_snapshot: ReturnType<typeof vi.fn>;
  task_snapshot: {
    busy: boolean;
    task_type: string;
    status: string;
  };
};

type TranslationTaskRuntimeFixture = {
  translation_task_display_snapshot: null;
  translation_task_metrics: {
    active: boolean;
    stopping: boolean;
    completion_percent: number;
    processed_count: number;
    failed_count: number;
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
    completion_percent: number;
    processed_count: number;
    failed_count: number;
    average_output_speed: number;
    total_output_tokens: number;
  };
  analysis_waveform_history: number[];
  analysis_confirm_state: null;
  analysis_import_confirm_state: {
    open: boolean;
    duplicate_count: number;
    submitting: boolean;
  };
  open_analysis_detail_sheet: ReturnType<typeof vi.fn>;
  close_analysis_detail_sheet: ReturnType<typeof vi.fn>;
  request_start_or_continue_analysis: ReturnType<typeof vi.fn>;
  request_analysis_task_action_confirmation: ReturnType<typeof vi.fn>;
  confirm_analysis_task_action: ReturnType<typeof vi.fn>;
  close_analysis_task_action_confirmation: ReturnType<typeof vi.fn>;
  request_import_analysis_glossary: ReturnType<typeof vi.fn>;
  import_analysis_glossary_duplicate_skip: ReturnType<typeof vi.fn>;
  import_analysis_glossary_duplicate_overwrite: ReturnType<typeof vi.fn>;
  close_analysis_glossary_import_confirmation: ReturnType<typeof vi.fn>;
  refresh_analysis_task_snapshot: ReturnType<typeof vi.fn>;
};

type WorkbenchPickerFixture = {
  pickWorkbenchFilePath: ReturnType<typeof vi.fn<() => Promise<DesktopPathPickResult>>>;
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
    pickWorkbenchFilePath: vi.fn<() => Promise<DesktopPathPickResult>>(),
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
  value: create_desktop_bridge_api_mock({
    methods: workbench_picker_fixture.current,
  }),
  configurable: true,
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
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

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
      };
    },
  };
});

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

function create_runtime_fixture(): RuntimeFixture {
  return {
    apply_project_mutation_result: vi.fn(async () => {}),
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    project_store: {
      getState: () => {
        return {
          files: {},
          items: createProjectItemIndex(),
        };
      },
    },
    refresh_project_runtime: vi.fn(async () => {}),
    workbench_change_signal: {
      seq: 0,
    },
    refresh_task: vi.fn(async () => {}),
    settings_snapshot: {},
    refresh_project_snapshot: vi.fn(),
    sync_task_snapshot: vi.fn(),
    task_snapshot: {
      busy: false,
      task_type: "",
      status: "idle",
    },
  };
}

// workbench hook 测试只验证请求编排；空 changes 仍经过真实 mutation result 契约。
function create_project_mutation_result() {
  return {
    accepted: true,
    changes: [],
  };
}

function create_translation_task_runtime_fixture(): TranslationTaskRuntimeFixture {
  return {
    translation_task_display_snapshot: null,
    translation_task_metrics: {
      active: false,
      stopping: false,
      completion_percent: 0,
      processed_count: 0,
      failed_count: 0,
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
      completion_percent: 0,
      processed_count: 0,
      failed_count: 0,
      average_output_speed: 0,
      total_output_tokens: 0,
    },
    analysis_waveform_history: [],
    analysis_confirm_state: null,
    analysis_import_confirm_state: {
      open: false,
      duplicate_count: 0,
      submitting: false,
    },
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

function create_project_store_state(items: Record<string, ProjectItemPublicRecord>) {
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
    items: createProjectItemIndex(items),
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
  src?: string;
  dst?: string;
  file_path?: string;
  status?: ProjectItemPublicRecord["status"];
}): ProjectItemPublicRecord {
  return {
    item_id: args.item_id,
    file_path: args.file_path ?? "old.txt",
    row_number: args.item_id,
    src: args.src ?? "",
    dst: args.dst ?? "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    file_type: "TXT",
    status: args.status ?? "PROCESSED",
    text_type: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
  };
}

function create_analysis_task_snapshot(
  overrides: Partial<AnalysisTaskSnapshot> = {},
): AnalysisTaskSnapshot {
  return {
    runtime_revision: 0,
    task_type: "analysis",
    status: "running",
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
    candidate_count: 0,
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
  });

  it("收到本次项目读取对应的工作台信号后才会落到 ready", async () => {
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
            items: createProjectItemIndex({
              "1": create_project_item({
                item_id: 1,
                file_path: "chapter01.txt",
                status: "EXCLUDED",
              }),
            }),
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

  it("全选全部文件时关闭删除权限且删除入口保持安静", async () => {
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
              "chapter02.txt": {
                rel_path: "chapter02.txt",
                file_type: "TXT",
                sort_index: 2,
              },
            },
            items: createProjectItemIndex(),
          };
        },
      },
      workbench_change_signal: {
        seq: 1,
      },
    };
    await render_hook();

    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["chapter01.txt", "chapter02.txt"],
        active_row_id: "chapter02.txt",
        anchor_row_id: "chapter01.txt",
      });
    });

    expect(latest_state?.can_delete_selected_files).toBe(false);

    act(() => {
      latest_state?.request_delete_selected_files();
    });

    expect(latest_state?.dialog_state.kind).toBeNull();
    expect(toast_fixture.current.push_toast).not.toHaveBeenCalled();
  });

  it("运行中翻译统计仍只按 ProjectStore.items.status 派生", async () => {
    translation_runtime_fixture.current = {
      ...translation_runtime_fixture.current,
      translation_task_metrics: {
        ...translation_runtime_fixture.current.translation_task_metrics,
        active: true,
        completion_percent: 88,
        processed_count: 99,
        failed_count: 10,
      },
    };
    analysis_runtime_fixture.current = {
      ...analysis_runtime_fixture.current,
      analysis_task_metrics: {
        ...analysis_runtime_fixture.current.analysis_task_metrics,
        active: true,
        completion_percent: 66,
        processed_count: 77,
        failed_count: 6,
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
            items: createProjectItemIndex({
              "1": create_project_item({
                item_id: 1,
                file_path: "chapter01.txt",
                status: "PROCESSED",
              }),
              "2": create_project_item({
                item_id: 2,
                file_path: "chapter01.txt",
                status: "ERROR",
              }),
              "3": create_project_item({
                item_id: 3,
                file_path: "chapter01.txt",
                status: "NONE",
              }),
              "4": create_project_item({
                item_id: 4,
                file_path: "chapter01.txt",
                status: "RULE_SKIPPED",
              }),
              "5": create_project_item({
                item_id: 5,
                file_path: "chapter01.txt",
                status: "EXCLUDED",
              }),
            }),
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
    expect(latest_state?.active_workbench_task_detail?.completion_percent_text).toBe("88.00%");

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

  it("运行中分析统计按 ProjectStore，详情进度按任务快照展示", async () => {
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
        completion_percent: 75,
        processed_count: 2,
        failed_count: 1,
      },
    };
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        task_type: "analysis",
        status: "running",
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
            items: createProjectItemIndex({
              "1": create_project_item({
                item_id: 1,
                file_path: "chapter01.txt",
                src: "一",
                status: "NONE",
              }),
              "2": create_project_item({
                item_id: 2,
                file_path: "chapter01.txt",
                src: "二",
                status: "NONE",
              }),
              "3": create_project_item({
                item_id: 3,
                file_path: "chapter01.txt",
                src: "三",
                status: "NONE",
              }),
              "4": create_project_item({
                item_id: 4,
                file_path: "chapter01.txt",
                src: "四",
                status: "NONE",
              }),
              "5": create_project_item({
                item_id: 5,
                file_path: "chapter01.txt",
                src: "五",
                status: "RULE_SKIPPED",
              }),
            }),
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
      completed_count: 0,
      failed_count: 0,
      pending_count: 4,
      skipped_count: 1,
      completion_percent: 20,
    });
    expect(latest_state?.analysis_stats).toMatchObject(latest_state?.stats ?? {});
    expect(latest_state?.active_workbench_task_detail?.completion_percent_text).toBe("75.00%");
  });

  it("运行中分析任务无有效总量时详情进度不沿用 ProjectStore 旧统计", async () => {
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
        completion_percent: 0,
      },
    };
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        task_type: "analysis",
        status: "running",
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
            items: createProjectItemIndex({
              "1": create_project_item({
                item_id: 1,
                file_path: "chapter01.txt",
                src: "一",
                status: "NONE",
              }),
              "2": create_project_item({
                item_id: 2,
                file_path: "chapter01.txt",
                src: "二",
                status: "NONE",
              }),
            }),
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
    expect(latest_state?.active_workbench_task_detail?.completion_percent_text).toBe("0.00%");
  });

  it("翻译统计会在 items 信号后继续按 ProjectStore 状态刷新", async () => {
    translation_runtime_fixture.current = {
      ...translation_runtime_fixture.current,
      translation_task_metrics: {
        ...translation_runtime_fixture.current.translation_task_metrics,
        active: true,
        completion_percent: 88,
        processed_count: 99,
        failed_count: 10,
      },
    };
    await render_hook();

    let item_status: ProjectItemPublicRecord["status"] = "NONE";
    let items_revision = 1;
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
            items: createProjectItemIndex({
              "1": create_project_item({
                item_id: 1,
                file_path: "chapter01.txt",
                status: item_status,
              }),
            }),
            revisions: {
              sections: {
                files: 1,
                items: items_revision,
                analysis: 1,
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
    items_revision = 2;
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
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
          file_type: "TXT",
          parsed_items: [{ src: "hello", dst: "", row: 1 }],
        },
      ],
    });
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file_from_path("E:/demo/new.txt");
    });

    expect(latest_state?.dialog_state.kind).toBe("inherit-import-files");
    expect(workbench_picker_fixture.current.pickWorkbenchFilePath).not.toHaveBeenCalled();
    expect(api_fetch).toHaveBeenCalledWith("/api/project/workbench/parse-file", {
      source_paths: ["E:/demo/new.txt"],
    });
    expect(api_fetch).toHaveBeenCalledTimes(1);
  });

  it("选择器添加文件会委托到同一条按路径解析流程", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      paths: ["E:/demo/new.txt"],
    });
    vi.mocked(api_fetch).mockResolvedValueOnce({
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
          file_type: "TXT",
          parsed_items: [{ src: "hello", dst: "", row: 1 }],
        },
      ],
    });
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file();
    });

    expect(latest_state?.dialog_state.kind).toBe("inherit-import-files");
    expect(api_fetch).toHaveBeenCalledWith("/api/project/workbench/parse-file", {
      source_paths: ["E:/demo/new.txt"],
    });
  });

  it("批量添加检测到同名文件时会先打开处理方式确认", async () => {
    vi.mocked(api_fetch).mockResolvedValueOnce({
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
          file_type: "TXT",
          parsed_items: [{ src: "こんにちは", dst: "", row: 1 }],
        },
        {
          source_path: "E:/demo/old-copy.txt",
          target_rel_path: "old.txt",
          file_type: "TXT",
          parsed_items: [{ src: "こんにちは", dst: "", row: 1 }],
        },
      ],
    });
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_files_from_paths([
        "E:/demo/new.txt",
        "E:/demo/bad.txt",
        "E:/demo/old-copy.txt",
      ]);
    });

    expect(latest_state?.dialog_state.kind).toBe("confirm-import-files");
    expect(latest_state?.dialog_state.target_rel_paths).toEqual(["old.txt"]);
    expect(api_fetch).toHaveBeenCalledWith("/api/project/workbench/parse-file", {
      source_paths: ["E:/demo/new.txt", "E:/demo/bad.txt", "E:/demo/old-copy.txt"],
    });
    expect(toast_fixture.current.push_toast).not.toHaveBeenCalled();
  });

  it("批量添加存在解析失败文件时展示完整跳过明细并继续处理成功文件", async () => {
    vi.mocked(api_fetch).mockResolvedValueOnce({
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
          file_type: "TXT",
          parsed_items: [{ src: "こんにちは", dst: "", row: 1 }],
        },
      ],
      failed_files: [
        {
          source_path: "E:/demo/broken.json",
          rel_path: "broken.json",
          filename: "broken.json",
          code: "file.parse_failed",
          message_key: "app.error.file.parse_failed.message",
        },
        {
          source_path: "E:/demo/dialogue.epub",
          rel_path: "dialogue.epub",
          filename: "dialogue.epub",
          code: "file.invalid_structure",
          message_key: "app.error.file.invalid_structure.message",
        },
      ],
    });
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_files_from_paths(["E:/demo/new.txt", "E:/demo/broken.json"]);
    });

    expect(latest_state?.dialog_state.kind).toBe("inherit-import-files");
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "warning",
      [
        "broken.json - app.error.file.parse_failed.message",
        "dialogue.epub - app.error.file.invalid_structure.message",
      ].join("\n"),
    );
  });

  it("批量添加全部文件解析失败时展示阻断明细且不再叠加泛错误", async () => {
    vi.mocked(api_fetch).mockResolvedValueOnce({
      files: [],
      failed_files: [
        {
          source_path: "E:/demo/broken.json",
          rel_path: "broken.json",
          filename: "broken.json",
          code: "file.parse_failed",
          message_key: "app.error.file.parse_failed.message",
        },
      ],
    });
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_files_from_paths(["E:/demo/broken.json"]);
    });

    expect(latest_state?.dialog_state.kind).toBeNull();
    expect(toast_fixture.current.push_toast).toHaveBeenCalledTimes(1);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "broken.json - app.error.file.parse_failed.message",
    );
  });

  it("批量添加没有有效文件时只提示一次错误", async () => {
    vi.mocked(api_fetch).mockResolvedValue({
      files: [
        {
          source_path: "E:/demo/dup-a.txt",
          target_rel_path: "dup.txt",
          file_type: "TXT",
          parsed_items: [],
        },
        {
          source_path: "E:/demo/dup-b.txt",
          target_rel_path: "DUP.txt",
          file_type: "TXT",
          parsed_items: [],
        },
      ],
    });
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_files_from_paths(["E:/demo/old-copy.txt"]);
    });

    expect(latest_state?.dialog_state.kind).toBeNull();
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "workbench_page.feedback.no_valid_file",
    );
  });

  it("同名确认选择跳过时只提交新增文件", async () => {
    vi.mocked(api_fetch)
      .mockResolvedValueOnce({
        files: [
          {
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
            file_type: "TXT",
            parsed_items: [{ src: "新規", dst: "", row: 1 }],
          },
          {
            source_path: "E:/demo/old-copy.txt",
            target_rel_path: "old.txt",
            file_type: "TXT",
            parsed_items: [{ src: "既存", dst: "", row: 1 }],
          },
        ],
      })
      .mockResolvedValueOnce(create_project_mutation_result());
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_files_from_paths(["E:/demo/new.txt", "E:/demo/old-copy.txt"]);
    });
    expect(latest_state?.dialog_state.kind).toBe("confirm-import-files");

    await act(async () => {
      await latest_state?.secondary_dialog();
    });
    expect(latest_state?.dialog_state.kind).toBe("inherit-import-files");
    expect(latest_state?.dialog_state.target_rel_paths).toEqual(["new.txt"]);

    await act(async () => {
      await latest_state?.cancel_dialog();
    });

    expect(api_fetch).toHaveBeenLastCalledWith(
      "/api/project/workbench/import-files",
      expect.objectContaining({
        files: [
          {
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
          },
        ],
        conflict_action: "skip",
        inheritance_mode: "none",
      }),
    );
  });

  it("同名确认选择替换时会把新增和替换文件一起提交", async () => {
    vi.mocked(api_fetch)
      .mockResolvedValueOnce({
        files: [
          {
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
            file_type: "TXT",
            parsed_items: [{ src: "新規", dst: "", row: 1 }],
          },
          {
            source_path: "E:/demo/old-copy.txt",
            target_rel_path: "old.txt",
            file_type: "TXT",
            parsed_items: [{ src: "既存", dst: "", row: 1 }],
          },
        ],
      })
      .mockResolvedValueOnce(create_project_mutation_result());
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_files_from_paths(["E:/demo/new.txt", "E:/demo/old-copy.txt"]);
    });
    expect(latest_state?.dialog_state.kind).toBe("confirm-import-files");

    await act(async () => {
      await latest_state?.confirm_dialog();
    });
    expect(latest_state?.dialog_state.kind).toBe("inherit-import-files");
    expect(latest_state?.dialog_state.target_rel_paths).toEqual(["new.txt", "old.txt"]);

    await act(async () => {
      await latest_state?.confirm_dialog();
    });

    expect(api_fetch).toHaveBeenLastCalledWith(
      "/api/project/workbench/import-files",
      expect.objectContaining({
        files: [
          {
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
          },
          {
            source_path: "E:/demo/old-copy.txt",
            target_rel_path: "old.txt",
          },
        ],
        conflict_action: "replace",
        inheritance_mode: "inherit",
      }),
    );
  });

  it("同名确认取消时不会提交导入 mutation", async () => {
    vi.mocked(api_fetch).mockResolvedValueOnce({
      files: [
        {
          source_path: "E:/demo/old-copy.txt",
          target_rel_path: "old.txt",
          file_type: "TXT",
          parsed_items: [{ src: "既存", dst: "", row: 1 }],
        },
      ],
    });
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_files_from_paths(["E:/demo/old-copy.txt"]);
    });
    expect(latest_state?.dialog_state.kind).toBe("confirm-import-files");

    await act(async () => {
      await latest_state?.cancel_dialog();
    });

    expect(latest_state?.dialog_state.kind).toBeNull();
    expect(api_fetch).toHaveBeenCalledTimes(1);
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

  it("选择不继承会直接提交 import-files", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      paths: ["E:/demo/new.txt"],
    });
    vi.mocked(api_fetch)
      .mockResolvedValueOnce({
        files: [
          {
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
            file_type: "TXT",
            parsed_items: [{ src: "こんにちは", dst: "", row: 1 }],
          },
        ],
      })
      .mockResolvedValueOnce(create_project_mutation_result());
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () => create_project_store_state({}),
      },
      settings_snapshot: {
        source_language: "JA",
        mtool_optimizer_enable: false,
        skip_duplicate_source_text_enable: true,
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file();
    });
    await render_hook();
    await act(async () => {
      await latest_state?.cancel_dialog();
    });

    expect(api_fetch).toHaveBeenLastCalledWith(
      "/api/project/workbench/import-files",
      expect.objectContaining({
        files: [
          expect.objectContaining({
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
          }),
        ],
        conflict_action: "skip",
        inheritance_mode: "none",
        project_settings: {
          source_language: "JA",
          mtool_optimizer_enable: false,
          skip_duplicate_source_text_enable: true,
        },
        expected_section_revisions: {
          files: 1,
          items: 2,
          analysis: 3,
        },
      }),
    );
  });

  it("选择继承且存在多候选时只提交继承模式", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      paths: ["E:/demo/new.txt"],
    });
    vi.mocked(api_fetch)
      .mockResolvedValueOnce({
        files: [
          {
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
            file_type: "TXT",
            parsed_items: [{ src: "こんにちは", dst: "", row: 1 }],
          },
        ],
      })
      .mockResolvedValueOnce(create_project_mutation_result());
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_store: {
        getState: () =>
          create_project_store_state({
            "1": create_project_item({ item_id: 1, src: "こんにちは", dst: "甲" }),
            "2": create_project_item({ item_id: 2, src: "こんにちは", dst: "乙" }),
            "3": create_project_item({ item_id: 3, src: "こんにちは", dst: "甲" }),
          }),
      },
      settings_snapshot: {
        source_language: "JA",
        mtool_optimizer_enable: false,
        skip_duplicate_source_text_enable: true,
      },
    };
    await render_hook();

    await act(async () => {
      await latest_state?.request_add_file();
    });
    await render_hook();
    await act(async () => {
      await latest_state?.confirm_dialog();
    });
    await render_hook();

    expect(latest_state?.dialog_state.kind).toBeNull();
    expect(api_fetch).toHaveBeenLastCalledWith(
      "/api/project/workbench/import-files",
      expect.objectContaining({
        files: [
          expect.objectContaining({
            source_path: "E:/demo/new.txt",
            target_rel_path: "new.txt",
          }),
        ],
        conflict_action: "skip",
        inheritance_mode: "inherit",
        project_settings: {
          source_language: "JA",
          mtool_optimizer_enable: false,
          skip_duplicate_source_text_enable: true,
        },
        expected_section_revisions: {
          files: 1,
          items: 2,
          analysis: 3,
        },
      }),
    );
  });

  it("翻译任务运行中允许生成当前可用译文", async () => {
    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        task_type: "translation",
        status: "running",
      },
    };
    await render_hook();

    act(() => {
      latest_state?.request_generate_translation();
    });

    expect(latest_state?.readonly).toBe(true);
    expect(latest_state?.can_edit_files).toBe(false);
    expect(latest_state?.can_generate_translation).toBe(true);
    expect(latest_state?.dialog_state.kind).toBe("generate-translation");
  });

  it("任务停止收尾中禁止生成译文", async () => {
    runtime_fixture.current = {
      ...runtime_fixture.current,
      task_snapshot: {
        busy: true,
        task_type: "translation",
        status: "stopping",
      },
    };
    await render_hook();

    act(() => {
      latest_state?.request_generate_translation();
    });

    expect(latest_state?.can_generate_translation).toBe(false);
    expect(latest_state?.dialog_state.kind).toBeNull();
  });

  it("导出提交中不会重复提交生成译文请求", async () => {
    vi.mocked(api_fetch).mockReturnValueOnce(new Promise(() => {}));
    await render_hook();

    act(() => {
      latest_state?.request_generate_translation();
    });
    await act(async () => {
      void latest_state?.confirm_dialog();
      await Promise.resolve();
    });

    expect(latest_state?.dialog_state.submitting).toBe(true);
    expect(latest_state?.can_generate_translation).toBe(false);

    await act(async () => {
      await latest_state?.confirm_dialog();
      await Promise.resolve();
    });

    expect(api_fetch).toHaveBeenCalledTimes(1);
    expect(api_fetch).toHaveBeenCalledWith("/api/tasks/generate-translation", {});
  });
});
