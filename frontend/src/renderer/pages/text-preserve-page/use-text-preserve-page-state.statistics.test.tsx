import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTextPreservePageState } from "./use-text-preserve-page-state";

const {
  api_fetch_mock,
  push_toast_mock,
  quality_statistics_compute_mock,
  quality_statistics_dispose_mock,
  wait_for_barrier_mock,
  create_barrier_checkpoint_mock,
  run_modal_progress_toast_mock,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
    quality_statistics_compute_mock: vi.fn(),
    quality_statistics_dispose_mock: vi.fn(),
    wait_for_barrier_mock: vi.fn(),
    create_barrier_checkpoint_mock: vi.fn(),
    run_modal_progress_toast_mock: vi.fn(async <T,>(args: { task: () => Promise<T> }) => {
      return await args.task();
    }),
  };
});

const runtime_state = {
  project: {
    path: "E:/demo/sample.lg",
    loaded: true,
  },
  files: {},
  items: {
    "1": {
      item_id: 1,
      file_path: "chapter01.txt",
      src: "foo42",
      dst: "bar",
    },
  },
  quality: {
    glossary: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
    pre_replacement: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
    post_replacement: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
    text_preserve: {
      entries: [
        {
          src: "^foo\\d+$",
          info: "保留编号",
        },
      ],
      enabled: true,
      mode: "custom",
      revision: 1,
    },
  },
  prompts: {
    translation: {
      text: "",
      enabled: false,
      revision: 0,
    },
    analysis: {
      text: "",
      enabled: false,
      revision: 0,
    },
  },
  analysis: {
    candidate_count: 0,
    candidate_aggregate: {},
  },
  proofreading: {
    revision: 0,
  },
  task: {
    task_type: null,
    status: "IDLE",
    busy: false,
    analysis_candidate_count: 0,
  },
  revisions: {
    projectRevision: 1,
    sections: {
      quality: 1,
      analysis: 0,
    },
  },
};

const project_store_listeners = new Set<() => void>();
let current_project_store_state = runtime_state;

const project_store = {
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState: () => current_project_store_state,
};

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/state/project-pages-context", () => {
  return {
    useProjectPagesBarrier: () => ({
      create_barrier_checkpoint: create_barrier_checkpoint_mock,
      wait_for_barrier: wait_for_barrier_mock,
    }),
  };
});

vi.mock("@/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => ({
      navigate_to_route: vi.fn(),
      push_proofreading_lookup_intent: vi.fn(),
    }),
  };
});

vi.mock("@/app/state/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: runtime_state.project,
      project_store,
      settings_snapshot: {},
      set_settings_snapshot: vi.fn(),
      commit_local_project_patch: vi.fn(),
      refresh_project_runtime: vi.fn(),
      align_project_runtime_ack: vi.fn(),
    }),
  };
});

vi.mock("@/app/state/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      run_modal_progress_toast: run_modal_progress_toast_mock,
    }),
  };
});

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/app/project-runtime/quality-statistics-client", () => {
  return {
    createQualityStatisticsClient: () => ({
      compute: quality_statistics_compute_mock,
      dispose: quality_statistics_dispose_mock,
    }),
  };
});

function Probe(props: {
  on_ready: (state: ReturnType<typeof useTextPreservePageState>) => void;
}): JSX.Element | null {
  const state = useTextPreservePageState();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useTextPreservePageState statistics", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useTextPreservePageState> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    quality_statistics_compute_mock.mockReset();
    quality_statistics_dispose_mock.mockReset();
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    wait_for_barrier_mock.mockReset();
    create_barrier_checkpoint_mock.mockReset();
    run_modal_progress_toast_mock.mockClear();
    create_barrier_checkpoint_mock.mockReturnValue({
      projectPath: "E:/demo/sample.lg",
      proofreadingLastLoadedAt: 1,
      workbenchLastLoadedAt: 1,
    });
    quality_statistics_compute_mock.mockResolvedValue({
      results: {
        "^foo\\d+$::0": {
          matched_item_count: 1,
          subset_parents: [],
        },
      },
    });
    current_project_store_state = {
      ...runtime_state,
      items: {
        "1": {
          item_id: 1,
          file_path: "chapter01.txt",
          src: "foo42",
          dst: "bar",
        },
      },
      quality: {
        ...runtime_state.quality,
        text_preserve: {
          entries: [
            {
              src: "^foo\\d+$",
              info: "保留编号",
            },
          ],
          enabled: true,
          mode: "custom",
          revision: 1,
        },
      },
    };
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    vi.useRealTimers();
    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    project_store_listeners.clear();
  });

  async function flush_microtasks(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function mount_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Probe
          on_ready={(state) => {
            latest_state = state;
          }}
        />,
      );
    });

    await flush_microtasks();
  }

  async function flush_statistics_context(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
  }

  async function emit_store_change(): Promise<void> {
    await act(async () => {
      project_store_listeners.forEach((listener) => {
        listener();
      });
    });
  }

  it("页面首次挂载时自动触发统计", async () => {
    await mount_probe();
    expect(quality_statistics_compute_mock).not.toHaveBeenCalled();
    expect(latest_state).not.toBeNull();

    await flush_statistics_context();

    expect(quality_statistics_compute_mock).toHaveBeenCalledTimes(1);
    expect(quality_statistics_compute_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        srcTexts: ["foo42"],
        rules: [
          expect.objectContaining({
            mode: "text_preserve",
            pattern: "^foo\\d+$",
          }),
        ],
      }),
    );
    expect(latest_state?.statistics_ready).toBe(true);
  });

  it("编辑窗口保存时会先关闭弹窗，不阻塞等待保存回包", async () => {
    await mount_probe();
    await flush_statistics_context();
    api_fetch_mock.mockReturnValueOnce(new Promise(() => {}));

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    expect(latest_state?.dialog_state.open).toBe(true);

    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "^bar\\d+$",
        info: "新规则",
      });
    });

    await act(async () => {
      void latest_state?.save_dialog_entry();
      await Promise.resolve();
    });

    expect(latest_state?.dialog_state.open).toBe(false);
  });

  it("相关文本变化后会在 200ms 防抖后自动重算", async () => {
    await mount_probe();
    await flush_statistics_context();
    quality_statistics_compute_mock.mockClear();

    current_project_store_state = {
      ...current_project_store_state,
      items: {
        ...current_project_store_state.items,
        "1": {
          ...current_project_store_state.items["1"],
          src: "foo77",
        },
      },
    };

    await emit_store_change();
    expect(quality_statistics_compute_mock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    expect(quality_statistics_compute_mock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(199);
      await Promise.resolve();
    });
    expect(quality_statistics_compute_mock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(quality_statistics_compute_mock).toHaveBeenCalledTimes(1);
    expect(quality_statistics_compute_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        srcTexts: ["foo77"],
      }),
    );
  });

  it("不相关字段变化不会触发自动统计", async () => {
    await mount_probe();
    await flush_statistics_context();
    quality_statistics_compute_mock.mockClear();

    current_project_store_state = {
      ...current_project_store_state,
      items: {
        ...current_project_store_state.items,
        "1": {
          ...current_project_store_state.items["1"],
          dst: "baz",
        },
      },
    };

    await emit_store_change();
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(quality_statistics_compute_mock).not.toHaveBeenCalled();
  });
});
