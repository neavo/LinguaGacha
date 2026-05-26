import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProjectRuntimeChangeSignal } from "@/app/desktop/desktop-runtime-context";
import { INPUT_QUERY_DEBOUNCE_MS } from "@/hooks/use-debounce";
import type { ProjectItemPublicRecord } from "@base/item";
import { ProjectUiWorkerClientError } from "@/project/worker/project-ui-worker-errors";
import {
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
} from "@/pages/proofreading-page/types";
import { useProofreadingPageState } from "@/pages/proofreading-page/use-proofreading-page-state";
import { createProjectItemIndex } from "@/project/store/project-item-index";

type RuntimeFixture = {
  settings_snapshot: {
    source_language: string;
    target_language: string;
  };
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_store: {
    getState: () => Record<string, unknown>;
  };
  task_snapshot: {
    busy: boolean;
    task_type?: string;
    extras?: {
      kind: "translation";
      scope: { kind: "all" } | { kind: "items"; item_ids: number[] };
    };
  };
  sync_task_snapshot: ReturnType<typeof vi.fn>;
  project_change_signal: ProjectRuntimeChangeSignal;
  commit_project_mutation: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  refresh_task: ReturnType<typeof vi.fn>;
};

type NavigationFixture = {
  proofreading_lookup_intent: null;
  clear_proofreading_lookup_intent: ReturnType<typeof vi.fn>;
};

type ProofreadingRuntimeClientFixture = {
  hydrate_proofreading_full: ReturnType<typeof vi.fn>;
  apply_proofreading_item_delta: ReturnType<typeof vi.fn>;
  build_proofreading_list_view: ReturnType<typeof vi.fn>;
  read_proofreading_list_window: ReturnType<typeof vi.fn>;
  read_proofreading_row_ids_range: ReturnType<typeof vi.fn>;
  resolve_proofreading_row_index: ReturnType<typeof vi.fn>;
  read_proofreading_items_by_row_ids: ReturnType<typeof vi.fn>;
  build_proofreading_filter_panel: ReturnType<typeof vi.fn>;
  dispose_project: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

type ToastFixture = {
  dismiss_toast: ReturnType<typeof vi.fn>;
  push_progress_toast: ReturnType<typeof vi.fn>;
  push_toast: ReturnType<typeof vi.fn>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const { page_ui_state_store } = vi.hoisted(() => {
  return {
    page_ui_state_store: new Map<string, unknown>(),
  };
});

// create_project_item 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_project_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

// create_project_change_signal 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_project_change_signal(
  seq: number,
  options: {
    mode?: "full" | "delta" | "noop";
    itemIds?: Array<number | string>;
    updatedSections?: Array<ProjectRuntimeChangeSignal["updated_sections"][number] | "task">;
  } = {},
): ProjectRuntimeChangeSignal {
  const mode = options.mode ?? "full";
  const requested_sections =
    options.updatedSections ??
    (mode === "noop"
      ? ["proofreading"]
      : mode === "delta"
        ? ["items"]
        : ["project", "items", "quality"]);
  const updated_sections = requested_sections.filter(
    (section): section is ProjectRuntimeChangeSignal["updated_sections"][number] =>
      section !== "task",
  );
  const item_ids = options.itemIds ?? [];
  return {
    seq,
    reason: mode === "noop" ? "task_status_refresh" : "translation_commit",
    updated_sections,
    results:
      updated_sections.length === 0
        ? []
        : [
            {
              applied: true,
              source: mode === "noop" ? "task_status_refresh" : "translation_commit",
              projectRevision: seq,
              updatedSections: updated_sections,
              ...(updated_sections.includes("items")
                ? {
                    itemDelta: {
                      upsertItemIds: item_ids,
                      deleteItemIds: [],
                      fullReplace: mode !== "delta",
                    },
                  }
                : {}),
              sectionRevisions: {},
            },
          ],
  };
}

// runtime fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

// navigation fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const navigation_fixture: { current: NavigationFixture } = {
  current: create_navigation_fixture(),
};

// proofreading runtime client fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const proofreading_runtime_client_fixture: { current: ProofreadingRuntimeClientFixture } = {
  current: create_proofreading_runtime_client_fixture(),
};

// toast fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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

vi.mock("@/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => navigation_fixture.current,
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

vi.mock("@/project/worker/project-ui-worker-client", () => {
  return {
    getSharedProjectUiWorkerClient: () => proofreading_runtime_client_fixture.current,
  };
});

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
    report_renderer_error: vi.fn(async () => undefined),
  };
});

vi.mock("@/app/session/project-session-ui-state-context", () => {
  return {
    resolve_project_session_table_restore_scroll_row_id: (
      ui_state: {
        selected_row_ids: string[];
        active_row_id: string | null;
        anchor_row_id: string | null;
      } | null,
    ): string | null => {
      if (ui_state === null) {
        return null;
      }

      if (ui_state.selected_row_ids.length > 1) {
        return ui_state.selected_row_ids[0] ?? ui_state.active_row_id;
      }

      return ui_state.selected_row_ids[0] ?? ui_state.active_row_id ?? ui_state.anchor_row_id;
    },
    useProjectSessionUiState: () => ({
      get_page_ui_state: <UiState>(key: string): UiState | null => {
        return (page_ui_state_store.get(key) as UiState | undefined) ?? null;
      },
      set_page_ui_state: <UiState>(key: string, ui_state: UiState): void => {
        page_ui_state_store.set(key, ui_state);
      },
      update_page_ui_state: <UiState>(
        key: string,
        updater: (previous_ui_state: UiState | null) => UiState | null,
      ): void => {
        const previous_ui_state = (page_ui_state_store.get(key) as UiState | undefined) ?? null;
        const next_ui_state = updater(previous_ui_state);
        if (next_ui_state === null) {
          page_ui_state_store.delete(key);
        } else {
          page_ui_state_store.set(key, next_ui_state);
        }
      },
      clear_page_ui_state: (key: string): void => {
        page_ui_state_store.delete(key);
      },
    }),
  };
});

// create_quality_store_payload 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_quality_store_payload(): Record<string, unknown> {
  return {
    quality: {
      glossary: {
        enabled: false,
        revision: 0,
        entries: [],
      },
      pre_replacement: {
        enabled: false,
        revision: 0,
        entries: [],
      },
      post_replacement: {
        enabled: false,
        revision: 0,
        entries: [],
      },
      text_preserve: {
        mode: "off",
        revision: 0,
        entries: [],
      },
    },
    prompts: {
      translation: {
        enabled: false,
        text: "",
        revision: 0,
      },
      analysis: {
        enabled: false,
        text: "",
        revision: 0,
      },
    },
  };
}

// create_runtime_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_runtime_fixture(): RuntimeFixture {
  return {
    settings_snapshot: {
      source_language: "JA",
      target_language: "ZH",
    },
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    project_store: {
      getState: () => {
        const quality_payload = create_quality_store_payload();
        return {
          project: {
            path: "E:/demo/sample.lg",
          },
          proofreading: {
            revision: 1,
          },
          quality: quality_payload.quality,
          prompts: quality_payload.prompts,
          revisions: {
            sections: {
              items: 7,
              proofreading: 1,
            },
          },
          items: createProjectItemIndex({
            "1": create_project_item({
              item_id: 1,
              file_path: "chapter01.txt",
              row_number: 1,
              src: "foo",
              dst: "bar",
              status: "NONE",
              text_type: "NONE",
              retry_count: 0,
            }),
          }),
        };
      },
    },
    task_snapshot: {
      busy: false,
      task_type: "idle",
      extras: { kind: "translation", scope: { kind: "all" } },
    },
    sync_task_snapshot: vi.fn((snapshot) => {
      runtime_fixture.current = {
        ...runtime_fixture.current,
        task_snapshot: snapshot,
      };
    }),
    project_change_signal: create_project_change_signal(0, { updatedSections: [] }),
    commit_project_mutation: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      const payload = await run();
      return {
        payload,
        mutation_result: {
          accepted: true,
          changes: [],
        },
      };
    }),
    refresh_project_runtime: vi.fn(async () => {}),
    refresh_task: vi.fn(async () => runtime_fixture.current.task_snapshot),
  };
}

// create_navigation_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_navigation_fixture(): NavigationFixture {
  return {
    proofreading_lookup_intent: null,
    clear_proofreading_lookup_intent: vi.fn(),
  };
}

// create_sync_state 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_sync_state() {
  return {
    projectId: "E:/demo/sample.lg",
    sourceLanguage: "JA",
    targetLanguage: "ZH",
    revisions: {
      items: 7,
      quality: 0,
      proofreading: 1,
    },
    defaultFilters: {
      warning_types: ["NO_WARNING"],
      statuses: ["NONE"],
      file_paths: ["chapter01.txt"],
      glossary_terms: [],
      include_without_glossary_miss: true,
    },
  };
}

// create_deferred 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_deferred<T>(): Deferred<T> {
  let resolve_deferred: (value: T) => void = () => {};
  let reject_deferred: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolve_deferred = resolve;
    reject_deferred = reject;
  });
  return {
    promise,
    resolve: resolve_deferred,
    reject: reject_deferred,
  };
}

// create_client_item 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_client_item(item_id: number | string) {
  return {
    item_id,
    row_id: String(item_id),
    file_path: `chapter${item_id}.txt`,
    row_number: Number(item_id),
    src: `foo-${item_id}`,
    dst: `bar-${item_id}`,
    status: "NONE",
    warnings: [],
    warning_fragments_by_code: {},
    applied_glossary_terms: [],
    failed_glossary_terms: [],
    compressed_src: `foo-${item_id}`,
    compressed_dst: `bar-${item_id}`,
  };
}

// create_list_view 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_list_view() {
  return {
    ...create_empty_proofreading_list_view(),
    projectId: "E:/demo/sample.lg",
    revisions: {
      items: 7,
      quality: 0,
      proofreading: 1,
    },
    view_id: "view-1",
    row_count: 1,
    window_start: 0,
    window_rows: [
      {
        row_id: "1",
        item: create_client_item(1),
        compressed_src: "foo",
        compressed_dst: "bar",
      },
    ],
  };
}

// create_filter_panel 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_filter_panel() {
  return {
    ...create_empty_proofreading_filter_panel_state(),
    available_statuses: ["NONE"],
    status_count_by_code: {
      NONE: 1,
    },
    available_warning_types: ["NO_WARNING"],
    warning_count_by_code: {
      NO_WARNING: 1,
    },
    all_file_paths: ["chapter01.txt"],
    available_file_paths: ["chapter01.txt"],
    file_count_by_path: {
      "chapter01.txt": 1,
    },
    glossary_term_entries: [],
    without_glossary_miss_count: 1,
  };
}

// create_proofreading_runtime_client_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_proofreading_runtime_client_fixture(): ProofreadingRuntimeClientFixture {
  return {
    hydrate_proofreading_full: vi.fn(async () => create_sync_state()),
    apply_proofreading_item_delta: vi.fn(async () => create_sync_state()),
    build_proofreading_list_view: vi.fn(async () => create_list_view()),
    read_proofreading_list_window: vi.fn(async () => {
      return {
        view_id: "view-1",
        start: 0,
        row_count: 1,
        rows: create_list_view().window_rows,
      };
    }),
    read_proofreading_row_ids_range: vi.fn(async () => ["1"]),
    resolve_proofreading_row_index: vi.fn(async () => 0),
    read_proofreading_items_by_row_ids: vi.fn(async () => {
      return create_list_view().window_rows.map((row) => row.item);
    }),
    build_proofreading_filter_panel: vi.fn(async () => create_filter_panel()),
    dispose_project: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

// create_toast_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_toast_fixture(): ToastFixture {
  return {
    dismiss_toast: vi.fn(),
    push_progress_toast: vi.fn(() => "proofreading-loading-toast"),
    push_toast: vi.fn(),
  };
}

describe("useProofreadingPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useProofreadingPageState> | null = null;

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
    navigation_fixture.current = create_navigation_fixture();
    proofreading_runtime_client_fixture.current = create_proofreading_runtime_client_fixture();
    toast_fixture.current = create_toast_fixture();
    page_ui_state_store.clear();
    vi.mocked(api_fetch).mockReset();
    vi.useRealTimers();
  });

  // ProofreadingProbe 收口测试中的共享步骤，保证断言只关注当前行为。
  function ProofreadingProbe(): JSX.Element | null {
    latest_state = useProofreadingPageState();
    return null;
  }

  // flush_async_updates 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // render_hook 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(ProofreadingProbe));
    });
    await flush_async_updates();
  }

  // request_pending_confirmation 收口测试中的共享步骤，保证断言只关注当前行为。
  async function request_pending_confirmation(action: () => void): Promise<void> {
    await act(async () => {
      action();
    });
    await flush_async_updates();
  }

  it("项目路径切换后会基于当前 ProjectStore 完成首刷", async () => {
    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.apply_proofreading_item_delta,
    ).not.toHaveBeenCalled();
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.settled_project_path).toBe("E:/demo/sample.lg");
  });

  it("校对页首刷期间展示不定加载 toast 并在完成后关闭", async () => {
    const refresh_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    const hydrated_list_view = {
      ...create_list_view(),
      window_rows: [
        {
          row_id: "1",
          item: {
            ...create_client_item(1),
            warnings: ["FULL_HYDRATED"],
          },
          compressed_src: "foo",
          compressed_dst: "bar",
        },
      ],
    };
    proofreading_runtime_client_fixture.current.hydrate_proofreading_full = vi.fn(() => {
      return refresh_deferred.promise;
    });
    proofreading_runtime_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      return hydrated_list_view;
    });

    await render_hook();

    expect(latest_state?.cache_status).toBe("refreshing");
    expect(latest_state?.visible_items.map((row) => row.row_id)).toEqual(["1"]);
    expect(latest_state?.visible_items[0]?.item.warnings).toEqual([]);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).not.toHaveBeenCalled();
    expect(toast_fixture.current.push_progress_toast).toHaveBeenCalledWith({
      message: "proofreading_page.feedback.loading_toast",
      presentation: "modal",
    });
    expect(toast_fixture.current.dismiss_toast).not.toHaveBeenCalledWith(
      "proofreading-loading-toast",
    );

    await act(async () => {
      refresh_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.visible_items[0]?.item.warnings).toEqual(["FULL_HYDRATED"]);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledWith(expect.any(Object), {
      staleKey: null,
    });
    expect(toast_fixture.current.dismiss_toast).toHaveBeenCalledWith("proofreading-loading-toast");
  });

  it("质量 hydrate 未完成时筛选弹窗不可打开但基础列表仍响应搜索", async () => {
    vi.useFakeTimers();
    const refresh_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_runtime_client_fixture.current.hydrate_proofreading_full = vi.fn(() => {
      return refresh_deferred.promise;
    });

    await render_hook();

    await act(async () => {
      latest_state?.open_filter_dialog();
      latest_state?.update_search_keyword("foo");
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
    await flush_async_updates();

    expect(latest_state?.filter_dialog_open).toBe(false);
    expect(latest_state?.cache_status).toBe("refreshing");
    expect(latest_state?.visible_items.map((row) => row.row_id)).toEqual(["1"]);

    await act(async () => {
      latest_state?.update_search_keyword("missing");
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
    await flush_async_updates();

    expect(latest_state?.visible_row_count).toBe(0);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();
  });

  it("缓存 ready 后再次收到 delta 信号时会走增量路径而不是全量 hydrate", async () => {
    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(expect.objectContaining({ window_start: 0, window_count: 128 }), {
      staleKey: null,
    });
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "delta",
        itemIds: [1],
        updatedSections: ["items"],
      }),
    };
    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.apply_proofreading_item_delta,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.visible_items).toHaveLength(1);
  });

  it("翻译写回触发 delta 刷新时不会弹出模态 loading toast", async () => {
    await render_hook();
    toast_fixture.current.push_progress_toast.mockClear();
    toast_fixture.current.dismiss_toast.mockClear();
    const delta_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_runtime_client_fixture.current.apply_proofreading_item_delta = vi.fn(() => {
      return delta_deferred.promise;
    });

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "delta",
        itemIds: [1],
        updatedSections: ["items"],
      }),
    };
    await render_hook();

    expect(latest_state?.cache_status).toBe("refreshing");
    expect(toast_fixture.current.push_progress_toast).not.toHaveBeenCalled();

    await act(async () => {
      delta_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(toast_fixture.current.push_progress_toast).not.toHaveBeenCalled();
    expect(toast_fixture.current.dismiss_toast).not.toHaveBeenCalledWith(
      "proofreading-loading-toast",
    );
  });

  it("目标语言变化后会全量重建 worker 校对缓存", async () => {
    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenLastCalledWith(expect.objectContaining({ targetLanguage: "ZH" }));

    runtime_fixture.current = {
      ...runtime_fixture.current,
      settings_snapshot: {
        ...runtime_fixture.current.settings_snapshot,
        target_language: "EN",
      },
      project_change_signal: create_project_change_signal(1, {
        mode: "delta",
        itemIds: [1],
        updatedSections: ["items"],
      }),
    };
    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenCalledTimes(2);
    expect(
      proofreading_runtime_client_fixture.current.apply_proofreading_item_delta,
    ).not.toHaveBeenCalled();
  });

  it("缓存 ready 后收到 noop 信号不会重新查询列表和筛选面板", async () => {
    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "noop",
        itemIds: [],
        updatedSections: ["proofreading", "task"],
      }),
    };
    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.hydrate_proofreading_full,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.apply_proofreading_item_delta,
    ).not.toHaveBeenCalled();
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");
  });

  it("打开筛选弹窗时不会再触发首次面板计算", async () => {
    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    expect(latest_state?.filter_dialog_open).toBe(true);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
  });

  it("全量刷新只等待列表完成，筛选面板在后台预热", async () => {
    const filter_panel_deferred = create_deferred<ReturnType<typeof create_filter_panel>>();
    proofreading_runtime_client_fixture.current.build_proofreading_filter_panel = vi.fn(() => {
      return filter_panel_deferred.promise;
    });

    await render_hook();

    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.visible_items).toHaveLength(1);
    expect(latest_state?.filter_panel.available_statuses).toEqual([]);

    await act(async () => {
      filter_panel_deferred.resolve(create_filter_panel());
    });
    await flush_async_updates();

    expect(latest_state?.filter_panel.available_statuses).toEqual(["NONE"]);
  });

  it("搜索输入更新时输入本身不会被后台列表查询阻塞", async () => {
    vi.useFakeTimers();
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    proofreading_runtime_client_fixture.current.build_proofreading_list_view.mockClear();

    await act(async () => {
      latest_state?.update_search_keyword("needle");
    });

    expect(latest_state?.search_keyword).toBe("needle");
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    await flush_async_updates();
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush_async_updates();

    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: "needle", window_start: 0, window_count: 128 }),
    );
  });

  it("筛选面板统计会跟随弹窗筛选输入统一 250ms 防抖", async () => {
    vi.useFakeTimers();
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.filter_dialog_open).toBe(true);

    proofreading_runtime_client_fixture.current.build_proofreading_filter_panel.mockClear();

    await act(async () => {
      if (latest_state === null) {
        throw new Error("校对页面状态未准备就绪。");
      }
      latest_state.update_filter_dialog_filters({
        ...latest_state.filter_dialog_filters,
        statuses: [],
      });
    });

    expect(latest_state?.filter_dialog_filters.statuses).toEqual([]);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    await flush_async_updates();
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush_async_updates();

    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenLastCalledWith({
      filters: expect.objectContaining({
        statuses: [],
      }),
    });
  });

  it("缓存刷新开始后会取消筛选面板尚未发布的防抖查询", async () => {
    vi.useFakeTimers();
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.filter_dialog_open).toBe(true);

    proofreading_runtime_client_fixture.current.build_proofreading_filter_panel.mockClear();

    await act(async () => {
      if (latest_state === null) {
        throw new Error("校对页面状态未准备就绪。");
      }
      latest_state.update_filter_dialog_filters({
        ...latest_state.filter_dialog_filters,
        statuses: [],
      });
    });

    const refresh_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_runtime_client_fixture.current.hydrate_proofreading_full = vi.fn(() => {
      return refresh_deferred.promise;
    });
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(2, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    expect(latest_state?.cache_status).toBe("refreshing");
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
    await flush_async_updates();

    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      refresh_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenLastCalledWith({
      filters: expect.objectContaining({
        statuses: ["NONE"],
      }),
    });
  });

  it("读取可见范围时会按滚动预取窗口扩展请求", async () => {
    proofreading_runtime_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      return {
        ...create_list_view(),
        row_count: 1000,
      };
    });
    proofreading_runtime_client_fixture.current.read_proofreading_list_window = vi.fn(
      async (query: { view_id: string; start: number; count: number }) => {
        return {
          view_id: query.view_id,
          start: query.start,
          row_count: 1000,
          rows: [],
        };
      },
    );
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    await act(async () => {
      latest_state?.read_visible_range({
        start: 300,
        count: 10,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      proofreading_runtime_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 44,
      count: 522,
    });
  });

  it("替换下一个匹配时会按替换扫描块读取 worker 窗口", async () => {
    vi.useFakeTimers();
    proofreading_runtime_client_fixture.current.read_proofreading_list_window = vi.fn(
      async (query: { view_id: string; start: number; count: number }) => {
        return {
          view_id: query.view_id,
          start: query.start,
          row_count: 1,
          rows: [],
        };
      },
    );
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    await act(async () => {
      latest_state?.update_search_keyword("missing");
    });
    await flush_async_updates();

    await act(async () => {
      await latest_state?.replace_next_visible_match();
    });

    expect(
      proofreading_runtime_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 0,
      count: 256,
    });
  });

  it("切换可见窗口不会裁剪窗口外选区", async () => {
    proofreading_runtime_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      return {
        ...create_list_view(),
        row_count: 3,
        window_start: 0,
        window_rows: [
          {
            row_id: "1",
            item: create_client_item(1),
            compressed_src: "foo-1",
            compressed_dst: "bar-1",
          },
        ],
      };
    });
    proofreading_runtime_client_fixture.current.read_proofreading_list_window = vi.fn(async () => {
      return {
        view_id: "view-1",
        start: 1,
        row_count: 3,
        rows: [
          {
            row_id: "2",
            item: create_client_item(2),
            compressed_src: "foo-2",
            compressed_dst: "bar-2",
          },
        ],
      };
    });
    proofreading_runtime_client_fixture.current.read_proofreading_row_ids_range = vi.fn(
      async () => ["1", "2", "3"],
    );
    proofreading_runtime_client_fixture.current.resolve_proofreading_row_index = vi.fn(
      async () => 2,
    );
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["1", "3"],
        active_row_id: "3",
        anchor_row_id: "1",
      });
    });

    await act(async () => {
      latest_state?.read_visible_range({
        start: 1,
        count: 1,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest_state?.visible_items.map((item) => item.row_id)).toEqual(["2"]);
    expect(
      proofreading_runtime_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 0,
      count: 3,
    });
    expect(latest_state?.selected_row_ids).toEqual(["1", "3"]);
    expect(latest_state?.active_row_id).toBe("3");
    expect(latest_state?.anchor_row_id).toBe("1");
    await expect(latest_state?.resolve_visible_row_index_async("3")).resolves.toBe(2);
    expect(
      proofreading_runtime_client_fixture.current.resolve_proofreading_row_index,
    ).toHaveBeenCalledWith({
      view_id: "view-1",
      row_id: "3",
    });
  });

  it("排序语义变化会清空表格选区", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["1"],
        active_row_id: "1",
        anchor_row_id: "1",
      });
    });

    await act(async () => {
      latest_state?.apply_table_sort_state({
        column_id: "src",
        direction: "ascending",
      });
    });

    expect(latest_state?.selected_row_ids).toEqual([]);
    expect(latest_state?.active_row_id).toBeNull();
    expect(latest_state?.anchor_row_id).toBeNull();
  });

  it("重新进入校对页时保留搜索排序和选中位置", async () => {
    await render_hook();

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    await act(async () => {
      if (latest_state === null) {
        throw new Error("校对页面状态未准备就绪。");
      }

      latest_state.update_filter_dialog_filters({
        ...latest_state.filter_dialog_filters,
        statuses: [],
      });
      await latest_state.confirm_filter_dialog_filters();
    });
    await flush_async_updates();

    await act(async () => {
      latest_state?.update_search_keyword("foo");
      latest_state?.apply_table_sort_state({
        column_id: "src",
        direction: "descending",
      });
      latest_state?.apply_table_selection({
        selected_row_ids: ["1"],
        active_row_id: "1",
        anchor_row_id: "1",
      });
    });

    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    proofreading_runtime_client_fixture.current.build_proofreading_list_view.mockClear();

    await render_hook();

    expect(latest_state?.search_keyword).toBe("foo");
    expect(latest_state?.current_filters.statuses).toEqual([]);
    expect(latest_state?.filter_dialog_filters.statuses).toEqual([]);
    expect(latest_state?.sort_state).toEqual({
      column_id: "src",
      direction: "descending",
    });
    expect(latest_state?.selected_row_ids).toEqual(["1"]);
    expect(latest_state?.active_row_id).toBe("1");
    expect(latest_state?.restore_scroll_row_id).toBe("1");

    await act(async () => {
      latest_state?.update_search_keyword("bar");
    });

    expect(latest_state?.selected_row_ids).toEqual([]);
    expect(latest_state?.active_row_id).toBeNull();
    expect(latest_state?.anchor_row_id).toBeNull();
    expect(latest_state?.restore_scroll_row_id).toBeNull();
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: "foo",
        filters: expect.objectContaining({
          statuses: [],
        }),
        sort_state: {
          column_id: "src",
          direction: "descending",
        },
      }),
      {
        staleKey: null,
      },
    );
  });

  it("worker 类错误会统一收口成刷新失败 toast", async () => {
    proofreading_runtime_client_fixture.current.hydrate_proofreading_full = vi.fn(async () => {
      throw new ProjectUiWorkerClientError("init_failed");
    });

    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(latest_state?.cache_status).toBe("error");
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "proofreading_page.feedback.refresh_failed",
    );
  });

  it("普通 worker 查询 stale 属于旧请求退场，不会弹刷新失败 toast", async () => {
    await render_hook();

    proofreading_runtime_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      throw new ProjectUiWorkerClientError("stale");
    });

    await act(async () => {
      latest_state?.update_search_scope("src");
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(toast_fixture.current.push_toast).not.toHaveBeenCalledWith(
      "error",
      "proofreading_page.feedback.refresh_failed",
    );
  });

  it("未建立 worker 项目缓存时卸载不会发送空项目释放请求", async () => {
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_snapshot: {
        loaded: false,
        path: "",
      },
    };
    await render_hook();

    await act(async () => {
      root?.unmount();
    });
    root = null;

    expect(proofreading_runtime_client_fixture.current.dispose_project).not.toHaveBeenCalled();
  });

  it("项目卸载会废弃在途刷新结果", async () => {
    const refresh_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_runtime_client_fixture.current.hydrate_proofreading_full = vi.fn(() => {
      return refresh_deferred.promise;
    });

    await render_hook();
    expect(latest_state?.cache_status).toBe("refreshing");

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_snapshot: {
        loaded: false,
        path: "",
      },
    };
    await render_hook();

    expect(latest_state?.cache_status).toBe("idle");
    expect(proofreading_runtime_client_fixture.current.dispose_project).toHaveBeenCalledWith(
      "E:/demo/sample.lg",
    );

    await act(async () => {
      refresh_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("idle");
    expect(latest_state?.settled_project_path).toBe("");
    expect(
      proofreading_runtime_client_fixture.current.build_proofreading_list_view,
    ).not.toHaveBeenCalled();
  });

  it("校对重翻请求收到任务回执后会通过 task snapshot 暴露正在重翻的行 id", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    const retranslate_deferred = create_deferred<{
      accepted: boolean;
      task: {
        task_type: string;
        status: string;
        busy: boolean;
        extras: { kind: "translation"; scope: { kind: "items"; item_ids: Array<number | string> } };
      };
    }>();
    vi.mocked(api_fetch).mockReturnValueOnce(retranslate_deferred.promise);

    await request_pending_confirmation(() => {
      latest_state?.request_retranslate_row_ids(["1"]);
    });
    expect(latest_state?.pending_confirmation).toMatchObject({
      kind: "retranslate",
      target_row_ids: ["1"],
      submitting: false,
    });

    let confirm_promise: Promise<void> | undefined;
    await act(async () => {
      confirm_promise = latest_state?.confirm_pending_confirmation();
      await Promise.resolve();
    });

    expect(latest_state?.retranslating_row_ids).toEqual([]);
    expect(latest_state?.pending_confirmation).toMatchObject({
      kind: "retranslate",
      submitting: true,
    });

    await act(async () => {
      retranslate_deferred.resolve({
        accepted: true,
        task: {
          task_type: "translation",
          status: "requested",
          busy: true,
          extras: { kind: "translation", scope: { kind: "items", item_ids: [1] } },
        },
      });
      await confirm_promise;
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/tasks/start", {
      task_type: "translation",
      mode: "new",
      scope: { kind: "items", item_ids: [1] },
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
        quality: 0,
        prompts: 0,
      },
    });
    expect(runtime_fixture.current.sync_task_snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: "translation",
        status: "requested",
        busy: true,
        extras: { kind: "translation", scope: { kind: "items", item_ids: [1] } },
      }),
    );
    expect(latest_state?.retranslating_row_ids).toEqual(["1"]);
    expect(toast_fixture.current.push_toast).not.toHaveBeenCalledWith(
      "success",
      expect.any(String),
    );
  });

  it("批量校对重翻会按请求顺序去重任务中的行 id", async () => {
    proofreading_runtime_client_fixture.current.read_proofreading_items_by_row_ids = vi.fn(
      async ({ row_ids }: { row_ids: string[] }) => {
        return row_ids.map((row_id) => create_client_item(row_id));
      },
    );
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    const retranslate_deferred = create_deferred<{
      accepted: boolean;
      task: {
        task_type: string;
        status: string;
        busy: boolean;
        extras: { kind: "translation"; scope: { kind: "items"; item_ids: Array<number | string> } };
      };
    }>();
    vi.mocked(api_fetch).mockReturnValueOnce(retranslate_deferred.promise);

    await request_pending_confirmation(() => {
      latest_state?.request_retranslate_row_ids(["2", "1", "2"]);
    });

    let confirm_promise: Promise<void> | undefined;
    await act(async () => {
      confirm_promise = latest_state?.confirm_pending_confirmation();
      await Promise.resolve();
    });

    expect(latest_state?.retranslating_row_ids).toEqual([]);

    await act(async () => {
      retranslate_deferred.resolve({
        accepted: true,
        task: {
          task_type: "translation",
          status: "requested",
          busy: true,
          extras: { kind: "translation", scope: { kind: "items", item_ids: [2, 1] } },
        },
      });
      await confirm_promise;
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/tasks/start", {
      task_type: "translation",
      mode: "new",
      scope: { kind: "items", item_ids: [2, 1] },
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
        quality: 0,
        prompts: 0,
      },
    });
    expect(latest_state?.retranslating_row_ids).toEqual(["2", "1"]);
  });

  it("校对重翻失败后不写入任务快照并保留错误提示", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    const retranslate_deferred = create_deferred<{
      accepted: boolean;
      task: {
        task_type: string;
      };
    }>();
    vi.mocked(api_fetch).mockReturnValueOnce(retranslate_deferred.promise);

    await request_pending_confirmation(() => {
      latest_state?.request_retranslate_row_ids(["1"]);
    });

    let confirm_promise: Promise<void> | undefined;
    await act(async () => {
      confirm_promise = latest_state?.confirm_pending_confirmation();
      await Promise.resolve();
    });

    expect(latest_state?.retranslating_row_ids).toEqual([]);

    await act(async () => {
      retranslate_deferred.reject(new Error("重翻失败"));
      await confirm_promise;
    });

    expect(runtime_fixture.current.sync_task_snapshot).not.toHaveBeenCalled();
    expect(latest_state?.retranslating_row_ids).toEqual([]);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "proofreading_page.feedback.retranslate_failed",
    );
  });

  it("确认清空译文时只提交目标条目和 revision 锁", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    vi.mocked(api_fetch).mockResolvedValueOnce({ accepted: true, changes: [] });
    proofreading_runtime_client_fixture.current.read_proofreading_items_by_row_ids.mockClear();

    await request_pending_confirmation(() => {
      latest_state?.request_clear_translation_row_ids(["1"]);
    });
    expect(latest_state?.pending_confirmation).toMatchObject({
      kind: "clear-translations",
      target_row_ids: ["1"],
      submitting: false,
    });
    await act(async () => {
      await latest_state?.confirm_pending_confirmation();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/project/proofreading/clear-translations", {
      item_ids: [1],
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
    expect(runtime_fixture.current.commit_project_mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "proofreading.mutation",
      }),
    );
    expect(
      proofreading_runtime_client_fixture.current.read_proofreading_items_by_row_ids,
    ).not.toHaveBeenCalled();
  });

  it("编辑弹窗保存时直接读取 ProjectStore 当前行，不再回读 worker item", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    await act(async () => {
      await latest_state?.open_edit_dialog("1");
    });
    proofreading_runtime_client_fixture.current.read_proofreading_items_by_row_ids.mockClear();
    vi.mocked(api_fetch).mockResolvedValueOnce({ accepted: true, changes: [] });

    await act(async () => {
      latest_state?.update_dialog_draft("新译文");
    });
    await act(async () => {
      await latest_state?.save_dialog_entry();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/project/proofreading/save-item", {
      item_id: 1,
      dst: "新译文",
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
    expect(
      proofreading_runtime_client_fixture.current.read_proofreading_items_by_row_ids,
    ).not.toHaveBeenCalled();
  });

  it("设置翻译状态会直接提交目标状态并保持译文由后端保留", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "full",
        itemIds: [],
        updatedSections: ["project", "items", "quality"],
      }),
    };
    await render_hook();

    vi.mocked(api_fetch).mockResolvedValueOnce({ accepted: true, changes: [] });
    proofreading_runtime_client_fixture.current.read_proofreading_items_by_row_ids.mockClear();

    await act(async () => {
      latest_state?.request_set_translation_status_row_ids(["1"], "PROCESSED");
    });
    await flush_async_updates();

    expect(latest_state?.pending_confirmation).toBeNull();
    expect(api_fetch).toHaveBeenCalledWith("/api/project/proofreading/set-status", {
      item_ids: [1],
      status: "PROCESSED",
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
    expect(runtime_fixture.current.commit_project_mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "proofreading.mutation",
      }),
    );
    expect(
      proofreading_runtime_client_fixture.current.read_proofreading_items_by_row_ids,
    ).not.toHaveBeenCalled();
  });
});
