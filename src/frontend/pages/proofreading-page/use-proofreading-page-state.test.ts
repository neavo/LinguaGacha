import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { ProjectSessionUiStateProvider } from "@frontend/app/session/project-session-ui-state-context";
import type { ProjectChangeSignal } from "@frontend/app/state/desktop-state-context";
import { INPUT_QUERY_DEBOUNCE_MS } from "@frontend/widgets/interactions/use-debounce";
import type { ProjectItemPublicRecord } from "@domain/item";
import type { ProjectDataSectionRevisions } from "@shared/project-event";
import {
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  type ProofreadingFilterOptions,
  type ProofreadingGlossaryTerm,
} from "@shared/proofreading/proofreading-types";
import { useProofreadingPageState } from "@frontend/pages/proofreading-page/use-proofreading-page-state";

// 模拟 Hook 依赖的桌面运行态、项目变更信号和写入回调。
type RuntimeFixture = {
  settings_snapshot: {
    source_language: string;
    target_language: string;
  };
  project_snapshot: {
    loaded: boolean;
    path: string;
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
  project_change_signal: ProjectChangeSignal;
  commit_project_write: ReturnType<typeof vi.fn>;
  refresh_project_state: ReturnType<typeof vi.fn>;
  refresh_task: ReturnType<typeof vi.fn>;
};

// 只保留校对页查找意图，避免页面测试依赖真实导航容器。
type NavigationFixture = {
  proofreading_lookup_intent: null;
  clear_proofreading_lookup_intent: ReturnType<typeof vi.fn>;
};

// 收口校对页所有远端查询入口，便于单用例替换具体行为。
type ProofreadingClientFixture = {
  sync_proofreading_cache: ReturnType<typeof vi.fn>;
  build_proofreading_list_view: ReturnType<typeof vi.fn>;
  read_proofreading_list_window: ReturnType<typeof vi.fn>;
  read_proofreading_row_ids_range: ReturnType<typeof vi.fn>;
  resolve_proofreading_row_index: ReturnType<typeof vi.fn>;
  read_proofreading_items_by_row_ids: ReturnType<typeof vi.fn>;
  build_proofreading_filter_panel: ReturnType<typeof vi.fn>;
  dispose_project: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

// 记录刷新和写入反馈，避免用例挂载真实 toast 宿主。
type ToastFixture = {
  dismiss_toast: ReturnType<typeof vi.fn>;
  push_progress_toast: ReturnType<typeof vi.fn>;
  push_toast: ReturnType<typeof vi.fn>;
};

// 让测试精确控制异步查询完成顺序，覆盖过期请求和竞态路径。
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

// 生成 runtime 查询返回的最小 item 记录，允许用 overrides 聚焦单个字段。
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

// 按 full、delta、noop 三类刷新场景生成桌面变更信号。
function create_project_change_signal(
  seq: number,
  options: {
    mode?: "full" | "delta" | "noop";
    itemIds?: Array<number | string>;
    updatedSections?: Array<ProjectChangeSignal["updated_sections"][number] | "task">;
    sectionRevisions?: ProjectDataSectionRevisions;
  } = {},
): ProjectChangeSignal {
  const mode = options.mode ?? "full";
  const requested_sections =
    options.updatedSections ??
    (mode === "noop"
      ? ["proofreading"]
      : mode === "delta"
        ? ["items"]
        : ["project", "items", "quality"]);
  const updated_sections = requested_sections.filter(
    (section): section is ProjectChangeSignal["updated_sections"][number] => section !== "task",
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
              sectionRevisions: options.sectionRevisions ?? {},
            },
          ],
  };
}

// 通过 mock useDesktopState 暴露可替换的桌面运行态快照。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

// 通过 mock useAppNavigation 暴露校对查找意图。
const navigation_fixture: { current: NavigationFixture } = {
  current: create_navigation_fixture(),
};

// 通过 mock API client 暴露每个用例可覆写的列表查询。
const proofreading_client_fixture: { current: ProofreadingClientFixture } = {
  current: create_proofreading_client_fixture(),
};

// 捕获页面反馈调用，避免测试依赖真实通知生命周期。
const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture.current,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => {
      return toast_fixture.current;
    },
  };
});

vi.mock("@frontend/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => navigation_fixture.current,
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

vi.mock("@frontend/pages/proofreading-page/proofreading-api-client", () => {
  return {
    createProofreadingApiClient: () => proofreading_client_fixture.current,
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
    report_renderer_error: vi.fn(async () => undefined),
  };
});

// 提供默认质量配置，支撑校对 sync 的完整 runtime 响应。
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

// 模拟项目已加载的常规状态，并把写入回调结果原样返回给 Hook。
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
    refresh_project_state: vi.fn(async () => {}),
    refresh_task: vi.fn(async () => runtime_fixture.current.task_snapshot),
  };
}

// 提供无查找意图的默认导航状态。
function create_navigation_fixture(): NavigationFixture {
  return {
    proofreading_lookup_intent: null,
    clear_proofreading_lookup_intent: vi.fn(),
  };
}

// 生成校对缓存 sync 结果，并允许用例覆盖默认筛选。
function create_sync_state(
  default_filter_patch: Partial<ProofreadingFilterOptions> = {},
  section_revisions_patch: ProjectDataSectionRevisions = {},
) {
  const default_filters: ProofreadingFilterOptions = {
    warning_types: ["NO_WARNING"],
    statuses: ["NONE"],
    file_paths: ["chapter01.txt"],
    glossary_terms: [],
    include_without_glossary_miss: true,
    ...default_filter_patch,
  };

  const syncState = {
    projectId: "E:/demo/sample.lg",
    sourceLanguage: "JA",
    targetLanguage: "ZH",
    revisions: {
      items: 7,
      quality: 0,
      proofreading: 1,
    },
    defaultFilters: default_filters,
  };
  return {
    syncState,
    sectionRevisions: {
      ...syncState.revisions,
      prompts: 0,
      ...section_revisions_patch,
    },
  };
}

// 暴露 promise 控制柄，用于验证异步列表请求的先后顺序。
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

// 生成前端列表行使用的校对 item，row_id 与 item_id 保持同源。
function create_client_item(item_id: number | string) {
  return {
    item_id,
    row_id: String(item_id),
    file_path: `chapter${item_id}.txt`,
    row_number: Number(item_id),
    src: `foo-${item_id}`,
    dst: `bar-${item_id}`,
    name_src: null,
    name_dst: null,
    status: "NONE",
    warnings: [],
    warning_fragments_by_code: {},
    applied_glossary_terms: [],
    failed_glossary_terms: [],
    compressed_src: `foo-${item_id}`,
    compressed_dst: `bar-${item_id}`,
  };
}

// 生成包含首屏窗口的默认列表 view，供刷新和窗口读取测试复用。
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

// 模拟 renderer 直读 runtime 的 sync 响应。
function create_proofreading_runtime_query_response() {
  const quality_payload = create_quality_store_payload();
  return {
    projectPath: "E:/demo/sample.lg",
    sectionRevisions: {
      items: 7,
      proofreading: 1,
    },
    runtimeSnapshot: {
      total_item_count: 1,
      items: [
        create_project_item({
          item_id: 1,
          file_path: "chapter01.txt",
          row_number: 1,
          src: "foo",
          dst: "bar",
          status: "NONE",
          text_type: "NONE",
          retry_count: 0,
        }),
      ],
      quality: quality_payload.quality,
    },
  };
}

// 把桌面 API 默认收口到 sync 和按 row_id 读行两类行为。
function install_api_fetch_default_mock(): void {
  vi.mocked(api_fetch).mockImplementation(async (path: string, body: unknown) => {
    if (path === "/api/proofreading/view") {
      const request = body as { action?: string; row_ids?: string[] };
      if (request.action === "sync") {
        return create_proofreading_runtime_query_response();
      }
      const row_ids = Array.isArray(request.row_ids) ? request.row_ids : [];
      return {
        rows: row_ids.map((row_id) => create_client_item(row_id)),
      };
    }
    return { accepted: true, changes: [] };
  });
}

// 提供校对筛选弹窗的默认可选项和计数。
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

// 模拟校对 API client 的常规成功路径。
function create_proofreading_client_fixture(): ProofreadingClientFixture {
  return {
    sync_proofreading_cache: vi.fn(async () => create_sync_state()),
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

// 让页面反馈调用可断言且不创建真实通知节点。
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
  let render_page = true;

  beforeEach(() => {
    install_api_fetch_default_mock();
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
    render_page = true;
    runtime_fixture.current = create_runtime_fixture();
    navigation_fixture.current = create_navigation_fixture();
    proofreading_client_fixture.current = create_proofreading_client_fixture();
    toast_fixture.current = create_toast_fixture();
    vi.mocked(api_fetch).mockReset();
    vi.useRealTimers();
  });

  function ProofreadingProbe(): JSX.Element | null {
    latest_state = useProofreadingPageState();
    return null;
  }

  // 保持项目 session provider 常驻，用显隐 Probe 模拟路由切换。
  function ProofreadingShell(): JSX.Element {
    return createElement(
      ProjectSessionUiStateProvider,
      null,
      render_page ? createElement(ProofreadingProbe) : null,
    );
  }

  // flush_async_updates 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 支撑当前测试场景的专用辅助逻辑。
   */
  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // render_hook 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 生成当前场景的展示内容。
   */
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    render_page = true;
    await act(async () => {
      root?.render(createElement(ProofreadingShell));
    });
    await flush_async_updates();
  }

  // unmount_page 只卸载页面 Probe，保留项目 session provider 来模拟跨路由恢复。
  async function unmount_page(): Promise<void> {
    if (root === null) {
      return;
    }

    render_page = false;
    latest_state = null;
    await act(async () => {
      root?.render(createElement(ProofreadingShell));
    });
    await flush_async_updates();
  }

  // request_pending_confirmation 收口测试中的共享步骤，保证断言只关注当前行为。
  /**
   * 支撑当前测试场景的专用辅助逻辑。
   */
  async function request_pending_confirmation(action: () => void): Promise<void> {
    await act(async () => {
      action();
    });
    await flush_async_updates();
  }

  it("项目路径切换后会基于当前后端 query 完成首刷", async () => {
    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.settled_project_path).toBe("E:/demo/sample.lg");
  });

  it("首次进入校对页时把默认意图展开为当前默认筛选", async () => {
    const glossary_term: ProofreadingGlossaryTerm = ["魔法", "Magic"];
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({
        statuses: ["NONE", "PROCESSED", "ERROR"],
        glossary_terms: [glossary_term],
      });
    });

    await render_hook();

    expect(latest_state?.current_filters.statuses).toEqual(["NONE", "PROCESSED", "ERROR"]);
    expect(latest_state?.current_filters.glossary_terms).toEqual([glossary_term]);
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          statuses: ["NONE", "PROCESSED", "ERROR"],
          glossary_terms: [glossary_term],
        }),
      }),
      {
        staleKey: null,
      },
    );
  });

  it("校对页首刷期间展示不定加载 toast 并在完成后关闭", async () => {
    const refresh_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    const synced_list_view = {
      ...create_list_view(),
      window_rows: [
        {
          row_id: "1",
          item: {
            ...create_client_item(1),
            warnings: ["FULL_SYNCED"],
          },
          compressed_src: "foo",
          compressed_dst: "bar",
        },
      ],
    };
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(() => {
      return refresh_deferred.promise;
    });
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      return synced_list_view;
    });

    await render_hook();

    expect(latest_state?.cache_status).toBe("refreshing");
    expect(latest_state?.visible_items).toEqual([]);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).not.toHaveBeenCalled();
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
    expect(latest_state?.visible_items[0]?.item.warnings).toEqual(["FULL_SYNCED"]);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledWith(
      expect.any(Object),
      {
        staleKey: null,
      },
    );
    expect(toast_fixture.current.dismiss_toast).toHaveBeenCalledWith("proofreading-loading-toast");
  });

  it("质量 sync 未完成时筛选弹窗不可打开且不触发列表查询", async () => {
    vi.useFakeTimers();
    const refresh_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(() => {
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
    expect(latest_state?.visible_items).toEqual([]);

    await act(async () => {
      latest_state?.update_search_keyword("missing");
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
    await flush_async_updates();

    expect(latest_state?.visible_row_count).toBe(0);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).not.toHaveBeenCalled();
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();
  });

  it("缓存 ready 后再次收到条目变更时按 delta 信号同步后端 query", async () => {
    await render_hook();

    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(1);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(expect.objectContaining({ window_start: 0, window_count: 128 }), {
      staleKey: null,
    });
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
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

    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(2);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 0,
      count: 128,
    });
    expect(latest_state?.preserve_scroll_anchor.row_id).toBe("1");
    expect(latest_state?.preserve_scroll_anchor.revision).toBeGreaterThan(0);
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.visible_items).toHaveLength(1);
  });

  it("翻译写回触发 delta 刷新时保留当前列表且不展示模态 loading toast", async () => {
    await render_hook();
    toast_fixture.current.push_progress_toast.mockClear();
    toast_fixture.current.dismiss_toast.mockClear();
    const sync_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(() => {
      return sync_deferred.promise;
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
    expect(latest_state?.visible_items).toHaveLength(1);
    expect(toast_fixture.current.push_progress_toast).not.toHaveBeenCalled();

    await act(async () => {
      sync_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(toast_fixture.current.dismiss_toast).not.toHaveBeenCalledWith(
      "proofreading-loading-toast",
    );
  });

  it("delta 刷新完成时保留打开中的筛选弹窗草稿", async () => {
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
    });
    expect(latest_state?.filter_dialog_open).toBe(true);
    expect(latest_state?.current_filters.statuses).toEqual(["NONE"]);
    expect(latest_state?.filter_dialog_filters.statuses).toEqual([]);

    const sync_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(() => {
      return sync_deferred.promise;
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

    await act(async () => {
      sync_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.filter_dialog_open).toBe(true);
    expect(latest_state?.current_filters.statuses).toEqual(["NONE"]);
    expect(latest_state?.filter_dialog_filters.statuses).toEqual([]);
  });

  it("目标语言变化后会全量重建校对列表缓存", async () => {
    await render_hook();

    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(1);
    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetLanguage: "ZH" }),
    );

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

    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(2);
  });

  it("缓存 ready 后收到 noop 信号不会重新查询列表和筛选面板", async () => {
    await render_hook();

    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(1);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
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

    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(1);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");
  });

  it("打开筛选弹窗时不会再触发首次面板计算", async () => {
    await render_hook();

    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    expect(latest_state?.filter_dialog_open).toBe(true);
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
  });

  it("全量刷新只等待列表完成，筛选面板在后台预热", async () => {
    const filter_panel_deferred = create_deferred<ReturnType<typeof create_filter_panel>>();
    proofreading_client_fixture.current.build_proofreading_filter_panel = vi.fn(() => {
      return filter_panel_deferred.promise;
    });

    await render_hook();

    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
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

    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();

    await act(async () => {
      latest_state?.update_search_keyword("needle");
    });

    expect(latest_state?.search_keyword).toBe("needle");
    expect(proofreading_client_fixture.current.build_proofreading_list_view).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    await flush_async_updates();
    expect(proofreading_client_fixture.current.build_proofreading_list_view).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush_async_updates();

    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
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

    proofreading_client_fixture.current.build_proofreading_filter_panel.mockClear();

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
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    await flush_async_updates();
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush_async_updates();

    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenLastCalledWith({
      filters: expect.objectContaining({
        statuses: [],
      }),
    });
  });

  it("确认筛选时会等待列表和面板刷新完成后再关闭弹窗", async () => {
    await render_hook();

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    const list_view_deferred = create_deferred<ReturnType<typeof create_list_view>>();
    const filter_panel_deferred = create_deferred<ReturnType<typeof create_filter_panel>>();
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(() => {
      return list_view_deferred.promise;
    });
    proofreading_client_fixture.current.build_proofreading_filter_panel = vi.fn(() => {
      return filter_panel_deferred.promise;
    });

    let confirm_promise: Promise<void> | null = null;
    await act(async () => {
      if (latest_state === null) {
        throw new Error("校对页面状态未准备就绪。");
      }

      latest_state.update_filter_dialog_filters({
        ...latest_state.filter_dialog_filters,
        statuses: [],
      });
      confirm_promise = latest_state.confirm_filter_dialog_filters();
      await Promise.resolve();
    });

    expect(latest_state?.filter_dialog_open).toBe(true);

    await act(async () => {
      list_view_deferred.resolve(create_list_view());
      filter_panel_deferred.resolve(create_filter_panel());
      await confirm_promise;
    });
    await flush_async_updates();

    expect(latest_state?.filter_dialog_open).toBe(false);
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

    proofreading_client_fixture.current.build_proofreading_filter_panel.mockClear();

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
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(() => {
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
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
    await flush_async_updates();

    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).not.toHaveBeenCalled();

    await act(async () => {
      refresh_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("ready");
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenCalledTimes(1);
    expect(
      proofreading_client_fixture.current.build_proofreading_filter_panel,
    ).toHaveBeenLastCalledWith({
      filters: expect.objectContaining({
        statuses: ["NONE"],
      }),
    });
  });

  it("读取可见范围时会按滚动预取窗口扩展请求", async () => {
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      return {
        ...create_list_view(),
        row_count: 1000,
      };
    });
    proofreading_client_fixture.current.read_proofreading_list_window = vi.fn(
      async (query: { view_id: string; start: number; count: number }) => {
        return {
          view_id: query.view_id,
          start: query.start,
          row_count: 1000,
          rows: [
            {
              row_id: String(query.start),
              item: create_client_item(query.start),
              compressed_src: `foo-${query.start}`,
              compressed_dst: `bar-${query.start}`,
            },
          ],
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
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 44,
      count: 522,
    });
  });

  it("项目刷新会保留当前滚动窗口", async () => {
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async (query) => {
      return {
        ...create_list_view(),
        row_count: 1000,
        window_start: query.window_start,
        window_rows: [],
      };
    });
    proofreading_client_fixture.current.read_proofreading_list_window = vi.fn(
      async (query: { view_id: string; start: number; count: number }) => {
        return {
          view_id: query.view_id,
          start: query.start,
          row_count: 1000,
          rows: [
            {
              row_id: String(query.start),
              item: create_client_item(query.start),
              compressed_src: `foo-${query.start}`,
              compressed_dst: `bar-${query.start}`,
            },
          ],
        };
      },
    );
    await render_hook();

    await act(async () => {
      latest_state?.read_visible_range({
        start: 300,
        count: 10,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["1"],
        active_row_id: "1",
        anchor_row_id: "1",
      });
    });
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "delta",
        itemIds: [1],
        updatedSections: ["items"],
      }),
    };
    await render_hook();

    expect(proofreading_client_fixture.current.build_proofreading_list_view).not.toHaveBeenCalled();
    expect(
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 44,
      count: 522,
    });
    expect(latest_state?.preserve_scroll_anchor.row_id).toBe("44");
    expect(latest_state?.preserve_scroll_anchor.revision).toBeGreaterThan(0);
    expect(latest_state?.visible_row_count).toBe(1000);
  });

  it("项目刷新遇到待执行搜索时会重建当前查询", async () => {
    vi.useFakeTimers();
    await render_hook();
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();
    proofreading_client_fixture.current.read_proofreading_list_window.mockClear();

    await act(async () => {
      latest_state?.update_search_keyword("needle");
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

    expect(
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).not.toHaveBeenCalled();
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keyword: "needle",
      }),
      {
        staleKey: null,
      },
    );
  });

  it("项目刷新等待期间输入搜索时会重建当前查询", async () => {
    vi.useFakeTimers();
    await render_hook();
    const sync_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(() => {
      return sync_deferred.promise;
    });
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();
    proofreading_client_fixture.current.read_proofreading_list_window.mockClear();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "delta",
        itemIds: [1],
        updatedSections: ["items"],
      }),
    };
    await render_hook();

    await act(async () => {
      latest_state?.update_search_keyword("needle");
    });
    await act(async () => {
      sync_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).not.toHaveBeenCalled();
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keyword: "needle",
      }),
      {
        staleKey: null,
      },
    );
  });

  it("项目刷新读到失效旧窗口时会按当前窗口重建列表", async () => {
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async (query) => {
      return {
        ...create_list_view(),
        row_count: 1000,
        window_start: query.window_start,
        window_rows: [],
      };
    });
    proofreading_client_fixture.current.read_proofreading_list_window = vi.fn(
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

    await act(async () => {
      latest_state?.read_visible_range({
        start: 300,
        count: 10,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();
    proofreading_client_fixture.current.read_proofreading_list_window = vi.fn(
      async (query: { view_id: string }) => {
        return {
          view_id: query.view_id,
          start: 0,
          row_count: 0,
          rows: [],
        };
      },
    );

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
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 44,
      count: 522,
    });
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        window_start: 44,
        window_count: 522,
      }),
      {
        staleKey: null,
      },
    );
    expect(latest_state?.visible_row_count).toBe(1000);
  });

  it("替换下一个匹配时会按替换扫描块读取列表窗口", async () => {
    vi.useFakeTimers();
    proofreading_client_fixture.current.read_proofreading_list_window = vi.fn(
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
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 0,
      count: 256,
    });
  });

  it("替换下一个匹配能提交姓名译文保存命令", async () => {
    proofreading_client_fixture.current.read_proofreading_list_window = vi.fn(async () => {
      return {
        view_id: "view-1",
        start: 0,
        row_count: 1,
        rows: [
          {
            row_id: "1",
            item: {
              ...create_client_item(1),
              dst: "正文译文",
              name_dst: "Name: Alice",
            },
            compressed_src: "foo",
            compressed_dst: "bar",
          },
        ],
      };
    });
    await render_hook();

    await act(async () => {
      latest_state?.update_search_keyword("Name");
      latest_state?.update_replace_text("Hero");
    });
    await flush_async_updates();
    vi.mocked(api_fetch).mockResolvedValueOnce({ accepted: true, changes: [] });

    await act(async () => {
      await latest_state?.replace_next_visible_match();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/proofreading/item/save", {
      item_id: 1,
      name_dst: "Hero: Alice",
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
  });

  it("替换全部会把姓名译文命中的行提交给后端", async () => {
    vi.useFakeTimers();
    const target_item = {
      ...create_client_item(1),
      dst: "正文译文",
      name_dst: "Name: Alice",
    };
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      return {
        ...create_list_view(),
        row_count: 1,
        window_rows: [
          {
            row_id: "1",
            item: target_item,
            compressed_src: "foo",
            compressed_dst: "bar",
          },
        ],
      };
    });
    proofreading_client_fixture.current.read_proofreading_row_ids_range = vi.fn(async () => ["1"]);
    proofreading_client_fixture.current.read_proofreading_items_by_row_ids = vi.fn(async () => [
      target_item,
    ]);
    await render_hook();

    await act(async () => {
      latest_state?.update_search_keyword("Name");
      latest_state?.update_replace_text("Hero");
    });
    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await flush_async_updates();
    vi.mocked(api_fetch).mockResolvedValueOnce({ accepted: true, changes: [] });
    expect(latest_state?.search_keyword).toBe("Name");
    expect(latest_state?.replace_text).toBe("Hero");
    expect(latest_state?.visible_row_count).toBe(1);
    proofreading_client_fixture.current.read_proofreading_row_ids_range.mockClear();

    await act(async () => {
      await latest_state?.replace_all_visible_matches();
    });

    expect(
      proofreading_client_fixture.current.read_proofreading_row_ids_range,
    ).toHaveBeenCalledWith({
      view_id: "view-1",
      start: 0,
      count: 1,
    });
    expect(api_fetch).toHaveBeenCalledWith("/api/proofreading/items/replace-all", {
      item_ids: [1],
      search_text: "Name",
      replace_text: "Hero",
      is_regex: false,
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
  });

  it("切换可见窗口不会裁剪窗口外选区", async () => {
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
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
    proofreading_client_fixture.current.read_proofreading_list_window = vi.fn(async () => {
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
    proofreading_client_fixture.current.read_proofreading_row_ids_range = vi.fn(async () => [
      "1",
      "2",
      "3",
    ]);
    proofreading_client_fixture.current.resolve_proofreading_row_index = vi.fn(async () => 2);
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
      proofreading_client_fixture.current.read_proofreading_list_window,
    ).toHaveBeenLastCalledWith({
      view_id: "view-1",
      start: 0,
      count: 3,
    });
    expect(latest_state?.selected_row_ids).toEqual(["1", "3"]);
    expect(latest_state?.active_row_id).toBe("3");
    expect(latest_state?.anchor_row_id).toBe("1");
    await expect(latest_state?.resolve_visible_row_index_async("3")).resolves.toBe(2);
    expect(proofreading_client_fixture.current.resolve_proofreading_row_index).toHaveBeenCalledWith(
      {
        view_id: "view-1",
        row_id: "3",
      },
    );
  });

  it("普通项目刷新不会把多选覆盖成单选", async () => {
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
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
          {
            row_id: "2",
            item: create_client_item(2),
            compressed_src: "foo-2",
            compressed_dst: "bar-2",
          },
          {
            row_id: "3",
            item: create_client_item(3),
            compressed_src: "foo-3",
            compressed_dst: "bar-3",
          },
        ],
      };
    });
    await render_hook();

    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["1", "3"],
        active_row_id: "3",
        anchor_row_id: "1",
      });
    });

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "delta",
        itemIds: [3],
        updatedSections: ["items"],
      }),
    };
    await render_hook();

    expect(latest_state?.selected_row_ids).toEqual(["1", "3"]);
    expect(latest_state?.active_row_id).toBe("3");
    expect(latest_state?.anchor_row_id).toBe("1");
  });

  it("写入后焦点恢复不会破坏包含目标行的多选", async () => {
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
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
          {
            row_id: "2",
            item: create_client_item(2),
            compressed_src: "foo-2",
            compressed_dst: "bar-2",
          },
          {
            row_id: "3",
            item: create_client_item(3),
            compressed_src: "foo-3",
            compressed_dst: "bar-3",
          },
        ],
      };
    });
    proofreading_client_fixture.current.read_proofreading_items_by_row_ids = vi.fn(
      async ({ row_ids }: { row_ids: string[] }) => {
        return row_ids.map((row_id) => create_client_item(row_id));
      },
    );
    await render_hook();

    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["1", "3"],
        active_row_id: "3",
        anchor_row_id: "1",
      });
    });

    vi.mocked(api_fetch).mockResolvedValueOnce({ accepted: true, changes: [] });
    await act(async () => {
      latest_state?.request_set_translation_status_row_ids(["1", "3"], "PROCESSED", "3");
      await Promise.resolve();
      await Promise.resolve();
    });

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        mode: "delta",
        itemIds: [3],
        updatedSections: ["items"],
      }),
    };
    await render_hook();

    expect(latest_state?.selected_row_ids).toEqual(["1", "3"]);
    expect(latest_state?.active_row_id).toBe("3");
    expect(latest_state?.anchor_row_id).toBe("1");
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

  it("只保存选区后重新进入会用新的术语缺失默认筛选", async () => {
    const glossary_term: ProofreadingGlossaryTerm = ["魔法", "Magic"];
    await render_hook();

    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["70"],
        active_row_id: "70",
        anchor_row_id: "70",
      });
    });

    await unmount_page();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({
        glossary_terms: [glossary_term],
      });
    });
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();

    await render_hook();

    expect(latest_state?.selected_row_ids).toEqual(["70"]);
    expect(latest_state?.current_filters.glossary_terms).toEqual([glossary_term]);
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          glossary_terms: [glossary_term],
        }),
      }),
      {
        staleKey: null,
      },
    );
  });

  // 回归 #625：未改动默认筛选时，页面重新进入后仍应使用最新术语默认范围。
  it("确认未改动的默认筛选后重新进入会选中新术语缺失", async () => {
    const glossary_term: ProofreadingGlossaryTerm = ["魔法", "Magic"];
    const next_glossary_term: ProofreadingGlossaryTerm = ["王国", "Kingdom"];
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({
        glossary_terms: [glossary_term],
      });
    });
    await render_hook();

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    await act(async () => {
      await latest_state?.confirm_filter_dialog_filters();
    });
    await flush_async_updates();

    await unmount_page();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({
        glossary_terms: [glossary_term, next_glossary_term],
      });
    });
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();

    await render_hook();

    expect(latest_state?.current_filters.glossary_terms).toEqual([
      glossary_term,
      next_glossary_term,
    ]);
    expect(latest_state?.filter_dialog_filters.glossary_terms).toEqual([
      glossary_term,
      next_glossary_term,
    ]);
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          glossary_terms: [glossary_term, next_glossary_term],
        }),
      }),
      {
        staleKey: null,
      },
    );
  });

  it("用户显式确认空术语筛选后重新进入仍保留空选择", async () => {
    const glossary_term: ProofreadingGlossaryTerm = ["魔法", "Magic"];
    const next_glossary_term: ProofreadingGlossaryTerm = ["王国", "Kingdom"];
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({
        glossary_terms: [glossary_term],
      });
    });
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
        glossary_terms: [],
      });
      await latest_state.confirm_filter_dialog_filters();
    });
    await flush_async_updates();

    await unmount_page();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({
        glossary_terms: [glossary_term, next_glossary_term],
      });
    });
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();

    await render_hook();

    expect(latest_state?.current_filters.glossary_terms).toEqual([]);
    expect(latest_state?.filter_dialog_filters.glossary_terms).toEqual([]);
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          glossary_terms: [],
        }),
      }),
      {
        staleKey: null,
      },
    );
  });

  it("项目身份重置后会重新使用默认筛选意图", async () => {
    const glossary_term: ProofreadingGlossaryTerm = ["魔法", "Magic"];
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
        glossary_terms: [],
      });
      await latest_state.confirm_filter_dialog_filters();
    });
    await flush_async_updates();

    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({
        glossary_terms: [glossary_term],
      });
    });
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_snapshot: {
        loaded: true,
        path: "E:/demo/another.lg",
      },
    };
    await render_hook();

    expect(latest_state?.current_filters.glossary_terms).toEqual([glossary_term]);
    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          glossary_terms: [glossary_term],
        }),
      }),
      {
        staleKey: null,
      },
    );
  });

  it("显式筛选意图会克隆术语 tuple", async () => {
    vi.useFakeTimers();
    const selected_filters: ProofreadingFilterOptions = {
      warning_types: ["NO_WARNING"],
      statuses: ["NONE"],
      file_paths: ["chapter01.txt"],
      glossary_terms: [["魔法", "Magic"]],
      include_without_glossary_miss: true,
    };
    await render_hook();

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    await act(async () => {
      if (latest_state === null) {
        throw new Error("校对页面状态未准备就绪。");
      }

      latest_state.update_filter_dialog_filters(selected_filters);
      await latest_state.confirm_filter_dialog_filters();
    });
    await flush_async_updates();
    selected_filters.glossary_terms[0] = ["污染", "Dirty"];
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();

    await act(async () => {
      latest_state?.update_search_keyword("foo");
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
    await flush_async_updates();

    expect(
      proofreading_client_fixture.current.build_proofreading_list_view,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          glossary_terms: [["魔法", "Magic"]],
        }),
        keyword: "foo",
      }),
    );
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

    await unmount_page();
    proofreading_client_fixture.current.build_proofreading_list_view.mockClear();

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
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledWith(
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

  it("重新进入校对页时保留多选和恢复锚点", async () => {
    proofreading_client_fixture.current.build_proofreading_list_view = vi.fn(async () => {
      return {
        ...create_list_view(),
        row_count: 3,
        window_rows: [
          {
            row_id: "1",
            item: create_client_item(1),
            compressed_src: "foo-1",
            compressed_dst: "bar-1",
          },
          {
            row_id: "2",
            item: create_client_item(2),
            compressed_src: "foo-2",
            compressed_dst: "bar-2",
          },
          {
            row_id: "3",
            item: create_client_item(3),
            compressed_src: "foo-3",
            compressed_dst: "bar-3",
          },
        ],
      };
    });
    await render_hook();

    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["1", "3"],
        active_row_id: "3",
        anchor_row_id: "1",
      });
    });

    await unmount_page();

    await render_hook();

    expect(latest_state?.selected_row_ids).toEqual(["1", "3"]);
    expect(latest_state?.active_row_id).toBe("3");
    expect(latest_state?.anchor_row_id).toBe("1");
    expect(latest_state?.restore_scroll_row_id).toBe("1");
  });

  it("列表运行态错误会统一收口成刷新失败 toast", async () => {
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      throw new Error("init_failed");
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

  it("未建立列表项目缓存时卸载不会发送空项目释放请求", async () => {
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

    expect(proofreading_client_fixture.current.dispose_project).not.toHaveBeenCalled();
  });

  it("项目卸载会废弃在途刷新结果", async () => {
    const refresh_deferred = create_deferred<ReturnType<typeof create_sync_state>>();
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(() => {
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
    expect(proofreading_client_fixture.current.dispose_project).not.toHaveBeenCalled();

    await act(async () => {
      refresh_deferred.resolve(create_sync_state());
    });
    await flush_async_updates();

    expect(latest_state?.cache_status).toBe("idle");
    expect(latest_state?.settled_project_path).toBe("");
    expect(proofreading_client_fixture.current.build_proofreading_list_view).not.toHaveBeenCalled();
  });

  it("sync 顶层 sectionRevisions 会作为重翻的完整操作基线", async () => {
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({}, { prompts: 3 });
    });
    await render_hook();
    vi.mocked(api_fetch).mockResolvedValueOnce({
      accepted: true,
      task: {
        task_type: "translation",
        status: "requested",
        busy: true,
      },
    });

    await request_pending_confirmation(() => {
      latest_state?.request_retranslate_row_ids(["1"]);
    });
    await act(async () => {
      await latest_state?.confirm_pending_confirmation();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/tasks/start", {
      task_type: "translation",
      mode: "new",
      scope: { kind: "items", item_ids: [1] },
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
        quality: 0,
        prompts: 3,
      },
    });
  });

  it("只含提示词的变更只更新操作基线并让后续重翻使用最新提示词 revision", async () => {
    proofreading_client_fixture.current.sync_proofreading_cache = vi.fn(async () => {
      return create_sync_state({}, { prompts: 3 });
    });
    await render_hook();
    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(1);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_change_signal: create_project_change_signal(1, {
        updatedSections: ["prompts"],
        sectionRevisions: { prompts: 4 },
      }),
    };
    await render_hook();

    expect(proofreading_client_fixture.current.sync_proofreading_cache).toHaveBeenCalledTimes(1);
    expect(proofreading_client_fixture.current.build_proofreading_list_view).toHaveBeenCalledTimes(
      1,
    );
    vi.mocked(api_fetch).mockResolvedValueOnce({
      accepted: true,
      task: {
        task_type: "translation",
        status: "requested",
        busy: true,
      },
    });

    await request_pending_confirmation(() => {
      latest_state?.request_retranslate_row_ids(["1"]);
    });
    await act(async () => {
      await latest_state?.confirm_pending_confirmation();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/tasks/start", {
      task_type: "translation",
      mode: "new",
      scope: { kind: "items", item_ids: [1] },
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
        quality: 0,
        prompts: 4,
      },
    });
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
    proofreading_client_fixture.current.read_proofreading_items_by_row_ids = vi.fn(
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
    proofreading_client_fixture.current.read_proofreading_items_by_row_ids.mockClear();

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

    expect(api_fetch).toHaveBeenCalledWith("/api/proofreading/translations/clear", {
      item_ids: [1],
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
    expect(runtime_fixture.current.commit_project_write).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "proofreading.write",
      }),
    );
    expect(
      proofreading_client_fixture.current.read_proofreading_items_by_row_ids,
    ).not.toHaveBeenCalled();
  });

  it("编辑弹窗保存时直接读取后端 query 当前行", async () => {
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
    proofreading_client_fixture.current.read_proofreading_items_by_row_ids.mockClear();
    vi.mocked(api_fetch).mockResolvedValueOnce({ accepted: true, changes: [] });

    await act(async () => {
      latest_state?.update_dialog_draft({ dst: "新译文" });
    });
    await act(async () => {
      await latest_state?.save_dialog_entry();
    });

    expect(api_fetch).toHaveBeenCalledWith("/api/proofreading/item/save", {
      item_id: 1,
      dst: "新译文",
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
    expect(
      proofreading_client_fixture.current.read_proofreading_items_by_row_ids,
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
    proofreading_client_fixture.current.read_proofreading_items_by_row_ids.mockClear();

    await act(async () => {
      latest_state?.request_set_translation_status_row_ids(["1"], "PROCESSED");
    });
    await flush_async_updates();

    expect(latest_state?.pending_confirmation).toBeNull();
    expect(api_fetch).toHaveBeenCalledWith("/api/proofreading/items/set-status", {
      item_ids: [1],
      status: "PROCESSED",
      expected_section_revisions: {
        items: 7,
        proofreading: 1,
      },
    });
    expect(runtime_fixture.current.commit_project_write).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "proofreading.write",
      }),
    );
    expect(
      proofreading_client_fixture.current.read_proofreading_items_by_row_ids,
    ).not.toHaveBeenCalled();
  });
});
