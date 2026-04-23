import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkerClientError } from "@/lib/worker-client-error";
import {
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
} from "@/pages/proofreading-page/types";
import { useProofreadingPageState } from "@/pages/proofreading-page/use-proofreading-page-state";

type RuntimeFixture = {
  settings_snapshot: {
    source_language: string;
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
  };
  proofreading_change_signal: {
    seq: number;
    mode: "full" | "delta" | "noop";
    item_ids: Array<number | string>;
    updated_sections: string[];
  };
  commit_local_project_patch: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  align_project_runtime_ack: ReturnType<typeof vi.fn>;
};

type NavigationFixture = {
  proofreading_lookup_intent: null;
  clear_proofreading_lookup_intent: ReturnType<typeof vi.fn>;
};

type ProofreadingRuntimeClientFixture = {
  hydrate_full: ReturnType<typeof vi.fn>;
  apply_item_delta: ReturnType<typeof vi.fn>;
  build_list_view: ReturnType<typeof vi.fn>;
  build_filter_panel: ReturnType<typeof vi.fn>;
  dispose_project: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const navigation_fixture: { current: NavigationFixture } = {
  current: create_navigation_fixture(),
};

const proofreading_runtime_client_fixture: { current: ProofreadingRuntimeClientFixture } = {
  current: create_proofreading_runtime_client_fixture(),
};

const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
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
      return toast_fixture.current;
    },
  };
});

vi.mock("@/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => navigation_fixture.current,
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

vi.mock("@/pages/proofreading-page/proofreading-runtime-client", () => {
  return {
    createProofreadingRuntimeClient: () => proofreading_runtime_client_fixture.current,
  };
});

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

function create_runtime_fixture(): RuntimeFixture {
  return {
    settings_snapshot: {
      source_language: "JA",
    },
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    project_store: {
      getState: () => {
        return {
          project: {
            path: "E:/demo/sample.lg",
          },
          proofreading: {
            revision: 1,
          },
          quality: {
            glossary: {
              enabled: false,
              mode: "off",
              revision: 0,
              entries: [],
            },
            pre_replacement: {
              enabled: false,
              mode: "off",
              revision: 0,
              entries: [],
            },
            post_replacement: {
              enabled: false,
              mode: "off",
              revision: 0,
              entries: [],
            },
            text_preserve: {
              enabled: false,
              mode: "off",
              revision: 0,
              entries: [],
            },
          },
          items: {
            "1": {
              item_id: 1,
              file_path: "chapter01.txt",
              row_number: 1,
              src: "foo",
              dst: "bar",
              status: "NONE",
              text_type: "NONE",
              retry_count: 0,
            },
          },
        };
      },
    },
    task_snapshot: {
      busy: false,
    },
    proofreading_change_signal: {
      seq: 0,
      mode: "full",
      item_ids: [],
      updated_sections: [],
    },
    commit_local_project_patch: vi.fn(() => {
      return {
        rollback: vi.fn(),
      };
    }),
    refresh_project_runtime: vi.fn(async () => {}),
    align_project_runtime_ack: vi.fn(),
  };
}

function create_navigation_fixture(): NavigationFixture {
  return {
    proofreading_lookup_intent: null,
    clear_proofreading_lookup_intent: vi.fn(),
  };
}

function create_sync_state() {
  return {
    revision: 1,
    project_id: "E:/demo/sample.lg",
    total_item_count: 1,
    review_item_count: 1,
    warning_item_count: 0,
    default_filters: {
      warning_types: ["NO_WARNING"],
      statuses: ["NONE"],
      file_paths: ["chapter01.txt"],
      glossary_terms: [],
      include_without_glossary_miss: true,
    },
  };
}

function create_list_view() {
  return {
    ...create_empty_proofreading_list_view(),
    revision: 1,
    project_id: "E:/demo/sample.lg",
    default_filters: create_sync_state().default_filters,
    filters: create_sync_state().default_filters,
    summary: {
      total_items: 1,
      filtered_items: 1,
      warning_items: 0,
    },
    items: [
      {
        row_id: "1",
        item: {
          item_id: 1,
          row_id: "1",
          file_path: "chapter01.txt",
          row_number: 1,
          src: "foo",
          dst: "bar",
          status: "NONE",
          warnings: [],
          applied_glossary_terms: [],
          failed_glossary_terms: [],
          compressed_src: "foo",
          compressed_dst: "bar",
        },
        compressed_src: "foo",
        compressed_dst: "bar",
      },
    ],
  };
}

function create_filter_panel() {
  return {
    ...create_empty_proofreading_filter_panel_state(),
    filters: create_sync_state().default_filters,
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

function create_proofreading_runtime_client_fixture(): ProofreadingRuntimeClientFixture {
  return {
    hydrate_full: vi.fn(async () => create_sync_state()),
    apply_item_delta: vi.fn(async () => create_sync_state()),
    build_list_view: vi.fn(async () => create_list_view()),
    build_filter_panel: vi.fn(async () => create_filter_panel()),
    dispose_project: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

function create_toast_fixture(): ToastFixture {
  return {
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
  });

  function ProofreadingProbe(): JSX.Element | null {
    latest_state = useProofreadingPageState();
    return null;
  }

  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
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
      root?.render(createElement(ProofreadingProbe));
    });
    await flush_async_updates();
  }

  it("项目路径切换后会先保持 refreshing，不会对空缓存立刻做 worker 同步", async () => {
    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(proofreading_runtime_client_fixture.current.hydrate_full).not.toHaveBeenCalled();
    expect(proofreading_runtime_client_fixture.current.apply_item_delta).not.toHaveBeenCalled();
    expect(latest_state?.cache_status).toBe("refreshing");
    expect(latest_state?.settled_project_path).toBe("");
    expect(latest_state?.last_loaded_at).toBeNull();
  });

  it("缓存 ready 后再次收到 delta 信号时会走增量路径而不是全量 hydrate", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      proofreading_change_signal: {
        seq: 1,
        mode: "full",
        item_ids: [],
        updated_sections: ["project", "items", "quality"],
      },
    };
    await render_hook();

    expect(proofreading_runtime_client_fixture.current.hydrate_full).toHaveBeenCalledTimes(1);
    expect(proofreading_runtime_client_fixture.current.build_list_view).toHaveBeenCalledTimes(1);
    expect(proofreading_runtime_client_fixture.current.build_filter_panel).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");

    runtime_fixture.current = {
      ...runtime_fixture.current,
      proofreading_change_signal: {
        seq: 2,
        mode: "delta",
        item_ids: [1],
        updated_sections: ["items"],
      },
    };
    await render_hook();

    expect(proofreading_runtime_client_fixture.current.hydrate_full).toHaveBeenCalledTimes(1);
    expect(proofreading_runtime_client_fixture.current.apply_item_delta).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.visible_items).toHaveLength(1);
  });

  it("打开筛选弹窗时不会再触发首次面板计算", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      proofreading_change_signal: {
        seq: 1,
        mode: "full",
        item_ids: [],
        updated_sections: ["project", "items", "quality"],
      },
    };
    await render_hook();

    expect(proofreading_runtime_client_fixture.current.build_filter_panel).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest_state?.open_filter_dialog();
    });
    await flush_async_updates();

    expect(latest_state?.filter_dialog_open).toBe(true);
    expect(proofreading_runtime_client_fixture.current.build_filter_panel).toHaveBeenCalledTimes(1);
  });

  it("搜索输入更新时输入本身不会被后台列表查询阻塞", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      proofreading_change_signal: {
        seq: 1,
        mode: "full",
        item_ids: [],
        updated_sections: ["project", "items", "quality"],
      },
    };
    await render_hook();

    await act(async () => {
      latest_state?.update_search_keyword("needle");
    });

    expect(latest_state?.search_keyword).toBe("needle");
  });

  it("worker 类错误会统一收口成页面已有的刷新失败提示", async () => {
    proofreading_runtime_client_fixture.current.hydrate_full = vi.fn(async () => {
      throw new WorkerClientError("底层 worker 初始化失败。", "init_failed");
    });

    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      proofreading_change_signal: {
        seq: 1,
        mode: "full",
        item_ids: [],
        updated_sections: ["project", "items", "quality"],
      },
    };
    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(latest_state?.cache_status).toBe("error");
    expect(latest_state?.refresh_error).toBe("proofreading_page.feedback.refresh_failed");
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "proofreading_page.feedback.refresh_failed",
    );
  });
});
