import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { ProjectItemPublicRecord } from "@domain/item";
import type { ProjectChangeSignal } from "@frontend/app/state/project-change-signal";
import type { AnalysisTaskSnapshot } from "@shared/workbench/analysis-task";
import type { AnalysisWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-analysis-workbench-task";
import type { TranslationWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-translation-workbench-task";
import { useWorkbenchPageState } from "@frontend/pages/workbench-page/use-workbench-page-state";
import type { DesktopPathPickResult } from "@gui/bridge-types";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

type RuntimeFixture = {
  commit_project_write: ReturnType<typeof vi.fn>;
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_store: {
    getState: () => {
      files: Record<string, unknown>;
      items: ReadonlyMap<number, ProjectItemPublicRecord>;
      analysis?: Record<string, unknown>;
      revisions?: {
        sections?: Record<string, number>;
      };
    };
  };
  refresh_project_state: ReturnType<typeof vi.fn>;
  project_change_signal: ProjectChangeSignal;
  refresh_task: ReturnType<typeof vi.fn>;
  settings_snapshot: Record<string, unknown>;
  refresh_project_snapshot: ReturnType<typeof vi.fn>;
  sync_task_snapshot: ReturnType<typeof vi.fn>;
  task_snapshot: {
    busy: boolean;
    task_type: string;
    status: string;
  };
  runtime_snapshot: { revision: number; owner: "task" | "agent" | null };
};

type TranslationWorkbenchTaskFixture = TranslationWorkbenchTask;

type AnalysisWorkbenchTaskFixture = AnalysisWorkbenchTask;

type WorkbenchPickerFixture = {
  pickWorkbenchFilePath: ReturnType<typeof vi.fn<() => Promise<DesktopPathPickResult>>>;
};

type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
  run_modal_progress_toast: ReturnType<typeof vi.fn>;
};

type WorkbenchQueryStats = {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
  completion_percent: number;
};

type ApiRouteResponder = unknown | ((body: Record<string, unknown>) => unknown | Promise<unknown>);

function create_test_items(
  items: Record<string, ProjectItemPublicRecord> = {},
): ReadonlyMap<number, ProjectItemPublicRecord> {
  return new Map(Object.values(items).map((item) => [item.item_id, item]));
}

// 可变容器让模块级 mock 在不重复注册模块的前提下读取每个用例的运行态。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const translation_runtime_fixture: { current: TranslationWorkbenchTaskFixture } = {
  current: create_translation_workbench_task_fixture(),
};

const analysis_runtime_fixture: { current: AnalysisWorkbenchTaskFixture } = {
  current: create_analysis_workbench_task_fixture(),
};

const workbench_picker_fixture: { current: WorkbenchPickerFixture } = {
  current: {
    pickWorkbenchFilePath: vi.fn<() => Promise<DesktopPathPickResult>>(),
  },
};

const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

const api_route_queues = new Map<string, ApiRouteResponder[]>();

Object.defineProperty(window, "desktopApp", {
  value: create_desktop_bridge_api_mock({
    methods: workbench_picker_fixture.current,
  }),
  configurable: true,
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture.current,
    useProjectChangeSignal: () => runtime_fixture.current.project_change_signal,
    useTaskSnapshot: () => runtime_fixture.current.task_snapshot,
    useRuntimeSnapshot: () => runtime_fixture.current.runtime_snapshot,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => {
      return toast_fixture.current;
    },
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
      };
    },
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
    report_renderer_error: vi.fn(async () => undefined),
  };
});

function create_project_change_signal(
  seq: number,
  options: {
    reason?: string;
    updatedSections?: ProjectChangeSignal["updated_sections"];
    itemIds?: Array<number | string>;
  } = {},
): ProjectChangeSignal {
  const updated_sections = options.updatedSections ?? ["project", "files", "items", "analysis"];
  const item_ids = options.itemIds ?? [];
  return {
    seq,
    reason: options.reason ?? "project_read_sections",
    updated_sections,
    results:
      updated_sections.length === 0
        ? []
        : [
            {
              applied: true,
              source: options.reason ?? "project_read_sections",
              projectRevision: seq,
              updatedSections: updated_sections,
              ...(updated_sections.includes("items")
                ? {
                    itemDelta: {
                      upsertItemIds: item_ids,
                      deleteItemIds: [],
                      fullReplace: item_ids.length === 0,
                    },
                  }
                : {}),
              sectionRevisions: {},
            },
          ],
  };
}

function create_runtime_fixture(): RuntimeFixture {
  return {
    commit_project_write: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      const payload = await run();
      return {
        payload,
        write_result: {
          accepted: true,
          changes: [],
        },
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
          items: create_test_items(),
        };
      },
    },
    refresh_project_state: vi.fn(async () => {}),
    project_change_signal: create_project_change_signal(0, { updatedSections: [] }),
    refresh_task: vi.fn(async () => {}),
    settings_snapshot: {},
    refresh_project_snapshot: vi.fn(),
    sync_task_snapshot: vi.fn(),
    task_snapshot: {
      busy: false,
      task_type: "",
      status: "idle",
    },
    runtime_snapshot: { revision: 0, owner: null },
  };
}

// 空 changes 仍经过真实写入结果契约。
function create_project_write_result() {
  return {
    accepted: true,
    changes: [],
  };
}

function enqueue_api_response(path: string, responder: ApiRouteResponder): void {
  const queue = api_route_queues.get(path) ?? [];
  queue.push(responder);
  api_route_queues.set(path, queue);
}

function setup_api_fetch_mock(): void {
  vi.mocked(api_fetch).mockImplementation(async (path: string, body = {}) => {
    const queue = api_route_queues.get(path);
    const responder = queue?.shift();
    if (responder !== undefined) {
      return typeof responder === "function" ? await responder(body) : responder;
    }

    if (path === "/api/workbench/snapshot") {
      return create_workbench_query_response();
    }
    if (path === "/api/workbench/file/parse") {
      return { files: [] };
    }
    if (path === "/api/translation/files/export") {
      return {};
    }
    return create_project_write_result();
  });
}

/**
 * 从可变项目仓库派生 mock 快照，使写入后的刷新能观察到新事实。
 */
function create_workbench_query_response(stats?: {
  translation?: WorkbenchQueryStats;
  analysis?: WorkbenchQueryStats;
}) {
  const state = runtime_fixture.current.project_store.getState();
  const files = Object.values(state.files ?? {}).flatMap((value) => {
    if (typeof value !== "object" || value === null) {
      return [];
    }
    const file = value as { rel_path?: unknown; file_type?: unknown; sort_index?: unknown };
    const rel_path = String(file.rel_path ?? "");
    if (rel_path === "") {
      return [];
    }
    return [
      {
        rel_path,
        file_type: String(file.file_type ?? "TXT"),
        sort_index: Number(file.sort_index ?? 0),
      },
    ];
  });
  const items = [...(state.items?.values() ?? [])];
  const default_stats: WorkbenchQueryStats = {
    total_items: items.length,
    completed_count: 0,
    failed_count: 0,
    pending_count: items.length,
    skipped_count: 0,
    completion_percent: 0,
  };
  const entries = files.map((file) => {
    return {
      ...file,
      item_count: items.filter((item) => item.file_path === file.rel_path).length,
    };
  });

  return {
    projectPath: runtime_fixture.current.project_snapshot.path,
    sectionRevisions: state.revisions?.sections ?? {
      files: 1,
      items: 2,
      analysis: 3,
    },
    snapshot: {
      file_count: entries.length,
      total_items: items.length,
      translation_stats: stats?.translation ?? default_stats,
      analysis_stats: stats?.analysis ?? default_stats,
      entries,
    },
  };
}

function count_api_calls(path: string): number {
  return vi.mocked(api_fetch).mock.calls.filter((call) => call[0] === path).length;
}

function create_translation_workbench_task_fixture(): TranslationWorkbenchTaskFixture {
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
  };
}

function create_analysis_workbench_task_fixture(): AnalysisWorkbenchTaskFixture {
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
      reasoning_tokens: 0,
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
    items: create_test_items(items),
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
    run_revision: 0,
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
    total_reasoning_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
    candidate_count: 0,
    ...overrides,
  };
}

describe("useWorkbenchPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useWorkbenchPageState> | null = null;

  beforeEach(() => {
    api_route_queues.clear();
    setup_api_fetch_mock();
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
    latest_state = null;
    runtime_fixture.current = create_runtime_fixture();
    translation_runtime_fixture.current = create_translation_workbench_task_fixture();
    analysis_runtime_fixture.current = create_analysis_workbench_task_fixture();
    toast_fixture.current = create_toast_fixture();
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockReset();
    vi.mocked(api_fetch).mockReset();
    api_route_queues.clear();
  });

  function WorkbenchProbe(): JSX.Element | null {
    latest_state = useWorkbenchPageState({
      translationWorkbenchTask: translation_runtime_fixture.current,
      analysisWorkbenchTask: analysis_runtime_fixture.current,
    });
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

  it("最后一次信号与工作台无关时仍会在首次挂载全量刷新", async () => {
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
            items: create_test_items({
              "1": create_project_item({
                item_id: 1,
                file_path: "chapter01.txt",
                status: "EXCLUDED",
              }),
            }),
          };
        },
      },
      project_change_signal: create_project_change_signal(1, { updatedSections: ["quality"] }),
    };
    enqueue_api_response(
      "/api/workbench/snapshot",
      create_workbench_query_response({
        translation: {
          total_items: 1,
          completed_count: 0,
          failed_count: 0,
          pending_count: 0,
          skipped_count: 1,
          completion_percent: 0,
        },
      }),
    );

    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.settled_project_path).toBe("E:/demo/sample.lg");
    expect(latest_state?.entries).toHaveLength(1);
    expect(latest_state?.stats.total_items).toBe(1);
    expect(latest_state?.stats.completed_count).toBe(0);
    expect(latest_state?.stats.skipped_count).toBe(1);
    expect(latest_state?.stats.completion_percent).toBe(0);
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
            items: create_test_items(),
          };
        },
      },
      project_change_signal: create_project_change_signal(1),
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

  it("运行中翻译统计仍只按后端 query items.status 计算", async () => {
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
            items: create_test_items({
              "1": create_project_item({ item_id: 1, file_path: "chapter01.txt" }),
              "2": create_project_item({ item_id: 2, file_path: "chapter01.txt" }),
              "3": create_project_item({ item_id: 3, file_path: "chapter01.txt" }),
              "4": create_project_item({ item_id: 4, file_path: "chapter01.txt" }),
              "5": create_project_item({ item_id: 5, file_path: "chapter01.txt" }),
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
      project_change_signal: create_project_change_signal(1),
    };
    const query_stats = {
      total_items: 5,
      completed_count: 1,
      failed_count: 1,
      pending_count: 1,
      skipped_count: 2,
      completion_percent: 20,
    };
    enqueue_api_response(
      "/api/workbench/snapshot",
      create_workbench_query_response({
        translation: query_stats,
        analysis: query_stats,
      }),
    );

    await render_hook();

    expect(latest_state?.stats).toMatchObject({
      total_items: 5,
      completed_count: 1,
      failed_count: 1,
      pending_count: 1,
      skipped_count: 2,
      completion_percent: 20,
    });
    expect(latest_state?.active_workbench_task_detail?.completion_percent_text).toBe("88.00%");

    act(() => {
      latest_state?.toggle_stats_mode();
    });

    expect(latest_state?.stats).toMatchObject({
      total_items: 5,
      completed_count: 1,
      failed_count: 1,
      pending_count: 1,
      skipped_count: 2,
      completion_percent: 20,
    });
  });

  it("任务详情时间指标使用时分秒格式且不展示单位", async () => {
    translation_runtime_fixture.current = {
      ...translation_runtime_fixture.current,
      translation_task_metrics: {
        ...translation_runtime_fixture.current.translation_task_metrics,
        active: true,
        elapsed_seconds: 87864.8,
        remaining_seconds: 3723.2,
      },
    };
    runtime_fixture.current = {
      ...runtime_fixture.current,
      runtime_snapshot: { revision: 1, owner: "task" },
      task_snapshot: {
        busy: true,
        task_type: "translation",
        status: "running",
      },
    };

    await render_hook();

    expect(latest_state?.active_workbench_task_detail?.metric_entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "elapsed",
          value_text: "24:24:24",
          unit_text: "",
        }),
        expect.objectContaining({
          key: "remaining-time",
          value_text: "01:02:03",
          unit_text: "",
        }),
      ]),
    );
  });

  it("运行中分析统计按后端 query，详情进度按任务快照展示", async () => {
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
    runtime_fixture.current = {
      ...runtime_fixture.current,
      runtime_snapshot: { revision: 1, owner: "task" },
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
            items: create_test_items({
              "1": create_project_item({ item_id: 1, file_path: "chapter01.txt" }),
              "2": create_project_item({ item_id: 2, file_path: "chapter01.txt" }),
              "3": create_project_item({ item_id: 3, file_path: "chapter01.txt" }),
              "4": create_project_item({ item_id: 4, file_path: "chapter01.txt" }),
              "5": create_project_item({ item_id: 5, file_path: "chapter01.txt" }),
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
      project_change_signal: create_project_change_signal(1),
    };
    enqueue_api_response(
      "/api/workbench/snapshot",
      create_workbench_query_response({
        analysis: {
          total_items: 5,
          completed_count: 0,
          failed_count: 0,
          pending_count: 4,
          skipped_count: 1,
          completion_percent: 0,
        },
      }),
    );

    await render_hook();

    expect(latest_state?.stats_mode).toBe("analysis");
    expect(latest_state?.stats).toMatchObject({
      total_items: 5,
      completed_count: 0,
      failed_count: 0,
      pending_count: 4,
      skipped_count: 1,
      completion_percent: 0,
    });
    expect(latest_state?.analysis_stats).toMatchObject(latest_state?.stats ?? {});
    expect(latest_state?.active_workbench_task_detail?.completion_percent_text).toBe("75.00%");
  });

  it("运行中分析任务无有效总量时详情进度不沿用后端 query 旧统计", async () => {
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
    runtime_fixture.current = {
      ...runtime_fixture.current,
      runtime_snapshot: { revision: 1, owner: "task" },
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
            items: create_test_items({
              "1": create_project_item({ item_id: 1, file_path: "chapter01.txt" }),
              "2": create_project_item({ item_id: 2, file_path: "chapter01.txt" }),
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
      project_change_signal: create_project_change_signal(1),
    };
    enqueue_api_response(
      "/api/workbench/snapshot",
      create_workbench_query_response({
        analysis: {
          total_items: 2,
          completed_count: 0,
          failed_count: 0,
          pending_count: 2,
          skipped_count: 0,
          completion_percent: 0,
        },
      }),
    );

    await render_hook();

    expect(latest_state?.analysis_stats).toMatchObject({
      total_items: 2,
      completed_count: 0,
      failed_count: 0,
      pending_count: 2,
      skipped_count: 0,
      completion_percent: 0,
    });
    expect(latest_state?.active_workbench_task_detail?.completion_percent_text).toBe("0.00%");
  });

  it("翻译统计会在 items 信号后继续按后端 query 状态刷新", async () => {
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
            items: create_test_items({
              "1": create_project_item({
                item_id: 1,
                file_path: "chapter01.txt",
                status: "NONE",
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
      project_change_signal: create_project_change_signal(1),
    };
    enqueue_api_response(
      "/api/workbench/snapshot",
      create_workbench_query_response({
        translation: {
          total_items: 1,
          completed_count: 0,
          failed_count: 0,
          pending_count: 1,
          skipped_count: 0,
          completion_percent: 0,
        },
      }),
    );

    await render_hook();

    expect(latest_state?.translation_stats).toMatchObject({
      total_items: 1,
      completed_count: 0,
      failed_count: 0,
      pending_count: 1,
      skipped_count: 0,
      completion_percent: 0,
    });

    items_revision = 2;
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(2, {
        reason: "translation_commit",
        updatedSections: ["items"],
        itemIds: [1],
      }),
    };
    enqueue_api_response(
      "/api/workbench/snapshot",
      create_workbench_query_response({
        translation: {
          total_items: 1,
          completed_count: 1,
          failed_count: 0,
          pending_count: 0,
          skipped_count: 0,
          completion_percent: 100,
        },
      }),
    );

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

  it("选择器添加文件会委托到同一条按路径解析流程", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      paths: ["E:/demo/new.txt"],
    });
    enqueue_api_response("/api/workbench/file/parse", {
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
    expect(api_fetch).toHaveBeenCalledWith("/api/workbench/file/parse", {
      source_paths: ["E:/demo/new.txt"],
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

  it("选择不继承会直接提交 import-files", async () => {
    workbench_picker_fixture.current.pickWorkbenchFilePath.mockResolvedValue({
      canceled: false,
      paths: ["E:/demo/new.txt"],
    });
    enqueue_api_response("/api/workbench/file/parse", {
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
          file_type: "TXT",
          parsed_items: [{ src: "こんにちは", dst: "", row: 1 }],
        },
      ],
    });
    enqueue_api_response("/api/workbench/files/import", create_project_write_result());
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
      await latest_state?.secondary_dialog();
    });

    expect(api_fetch).toHaveBeenCalledWith(
      "/api/workbench/files/import",
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

  it("翻译任务运行中允许生成当前可用译文", async () => {
    runtime_fixture.current = {
      ...runtime_fixture.current,
      runtime_snapshot: { revision: 1, owner: "task" },
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
      runtime_snapshot: { revision: 1, owner: "task" },
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
    enqueue_api_response("/api/translation/files/export", () => new Promise(() => {}));
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

    expect(count_api_calls("/api/translation/files/export")).toBe(1);
    expect(api_fetch).toHaveBeenCalledWith("/api/translation/files/export", {});
  });
});
