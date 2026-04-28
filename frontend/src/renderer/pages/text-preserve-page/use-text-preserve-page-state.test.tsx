import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QualityStatisticsCacheSnapshot } from "@/app/project/quality/quality-statistics-store";
import { useTextPreservePageState } from "./use-text-preserve-page-state";

const { api_fetch_mock, push_toast_mock, wait_for_barrier_mock, create_barrier_checkpoint_mock } =
  vi.hoisted(() => {
    return {
      api_fetch_mock: vi.fn(),
      push_toast_mock: vi.fn(),
      wait_for_barrier_mock: vi.fn(),
      create_barrier_checkpoint_mock: vi.fn(),
    };
  });

const run_modal_progress_toast_mock = vi.fn(
  async <T,>(args: {
    message: string;
    task: () => Promise<T>;
    timeout_ms?: number;
  }): Promise<T> => {
    if (args.timeout_ms === undefined) {
      return args.task();
    }

    return await Promise.race([
      args.task(),
      new Promise<T>((_resolve, reject) => {
        window.setTimeout(() => {
          reject(new Error("模态进度通知等待超时。"));
        }, args.timeout_ms);
      }),
    ]);
  },
);

let runtime_state = {
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
    glossary: { entries: [], enabled: true, mode: "off", revision: 0 },
    pre_replacement: { entries: [], enabled: true, mode: "off", revision: 0 },
    post_replacement: { entries: [], enabled: true, mode: "off", revision: 0 },
    text_preserve: {
      entries: [
        {
          src: "foo",
          info: "bar",
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
      items: 1,
      quality: 1,
      analysis: 0,
    },
  },
};

const project_store_listeners = new Set<() => void>();

function notify_project_store(): void {
  for (const listener of project_store_listeners) {
    listener();
  }
}

const project_store = {
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState: () => runtime_state,
};

let current_statistics_cache: QualityStatisticsCacheSnapshot;
let task_snapshot: { busy: boolean; status: string };

function create_statistics_cache(
  args: Partial<QualityStatisticsCacheSnapshot>,
): QualityStatisticsCacheSnapshot {
  return {
    running: false,
    ready: true,
    stale: false,
    failed: false,
    current_snapshot: {
      text_source: "src",
      text_signature: "texts",
      dependency_signature: "deps",
      snapshot_signature: "snapshot",
      rules: [
        {
          key: "foo::0",
          dependency_signature: "foo",
          relation_label: "foo",
          token: "foo",
        },
      ],
    },
    completed_snapshot: {
      text_source: "src",
      text_signature: "texts",
      dependency_signature: "deps",
      snapshot_signature: "snapshot",
      rules: [
        {
          key: "foo::0",
          dependency_signature: "foo",
          relation_label: "foo",
          token: "foo",
        },
      ],
    },
    completed_entry_ids: ["foo::0"],
    matched_count_by_entry_id: {
      "foo::0": 1,
    },
    subset_parent_labels_by_entry_id: {
      "foo::0": [],
    },
    last_error: null,
    request_token: 1,
    updated_at: 1,
    ...args,
  };
}

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/runtime/project-pages/project-pages-context", () => {
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

vi.mock("@/app/runtime/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: {
        loaded: true,
        path: "E:/demo/sample.lg",
      },
      project_store,
      settings_snapshot: {},
      set_settings_snapshot: vi.fn(),
      refresh_project_runtime: vi.fn(async () => {}),
      align_project_runtime_ack: vi.fn(),
      task_snapshot,
      commit_local_project_patch: (input: {
        patch: Array<{ op: string; quality?: typeof runtime_state.quality }>;
      }) => {
        const previous_quality = {
          ...runtime_state.quality,
          text_preserve: {
            ...runtime_state.quality.text_preserve,
            entries: runtime_state.quality.text_preserve.entries.map((entry) => ({ ...entry })),
          },
        };
        const quality_patch = input.patch.find((operation) => operation.op === "replace_quality");
        if (quality_patch?.quality !== undefined) {
          runtime_state = {
            ...runtime_state,
            quality: quality_patch.quality,
          };
          notify_project_store();
        }

        return {
          previousProjectRevision: 0,
          previousSectionRevisions: { quality: 0 },
          previousSections: { quality: previous_quality },
          rollback: () => {
            runtime_state = {
              ...runtime_state,
              quality: previous_quality,
            };
            notify_project_store();
          },
        };
      },
    }),
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      run_modal_progress_toast: run_modal_progress_toast_mock,
    }),
  };
});

vi.mock("@/app/project/quality/quality-statistics-context", () => {
  return {
    useQualityStatistics: () => current_statistics_cache,
  };
});

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
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

describe("useTextPreservePageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useTextPreservePageState> | null = null;

  beforeEach(() => {
    project_store_listeners.clear();
    current_statistics_cache = create_statistics_cache({});
    task_snapshot = {
      busy: false,
      status: "IDLE",
    };
    create_barrier_checkpoint_mock.mockReturnValue({
      projectPath: "E:/demo/sample.lg",
      proofreadingLastLoadedAt: 1,
      workbenchLastLoadedAt: 1,
    });
    runtime_state = {
      ...runtime_state,
      quality: {
        ...runtime_state.quality,
        text_preserve: {
          entries: [
            {
              src: "foo",
              info: "bar",
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
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    wait_for_barrier_mock.mockReset();
    create_barrier_checkpoint_mock.mockReset();
    run_modal_progress_toast_mock.mockClear();
  });

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
  }

  it("在校对缓存等待超时时保留已提交的模式并提示稍后刷新", async () => {
    vi.useFakeTimers();
    wait_for_barrier_mock.mockImplementation(async () => {
      return await new Promise<void>(() => {});
    });
    api_fetch_mock.mockResolvedValue({
      accepted: true,
    });

    await mount_probe();
    if (latest_state === null) {
      throw new Error("文本保护页面状态未准备就绪。");
    }

    let update_promise: Promise<void>;
    await act(async () => {
      update_promise = latest_state!.update_mode("smart");
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(20000);
      await update_promise!;
    });

    expect(latest_state?.mode).toBe("smart");
    expect(latest_state?.mode_updating).toBe(false);
    expect(push_toast_mock).toHaveBeenCalledWith(
      "warning",
      "text_preserve_page.feedback.mode_refresh_pending",
    );
  });

  it("在模式切换进行中忽略后续重复点击", async () => {
    const barrier_deferred: { resolve: () => void } = {
      resolve: () => {},
    };
    wait_for_barrier_mock.mockImplementation(async () => {
      return await new Promise<void>((resolve) => {
        barrier_deferred.resolve = resolve;
      });
    });
    api_fetch_mock.mockResolvedValue({
      accepted: true,
    });

    await mount_probe();
    if (latest_state === null) {
      throw new Error("文本保护页面状态未准备就绪。");
    }

    let first_update: Promise<void>;
    await act(async () => {
      first_update = latest_state!.update_mode("smart");
      await Promise.resolve();
    });
    let second_update: Promise<void>;
    await act(async () => {
      second_update = latest_state!.update_mode("off");
      await Promise.resolve();
    });

    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    expect(latest_state?.mode_updating).toBe(true);

    await act(async () => {
      barrier_deferred.resolve();
      await Promise.resolve();
      await first_update!;
      await second_update!;
    });

    expect(latest_state?.mode).toBe("smart");
    expect(latest_state?.mode_updating).toBe(false);
  });

  it("首次进入页面时直接读取预热后的统计结果", async () => {
    await mount_probe();

    expect(latest_state?.statistics_ready).toBe(true);
    expect(latest_state?.statistics_badge_by_entry_id["foo::0"]?.matched_count).toBe(1);
  });

  it("统计未 ready 时不会保留旧 statistics 排序", async () => {
    await mount_probe();

    await act(async () => {
      latest_state?.apply_table_sort_state({
        column_id: "statistics",
        direction: "descending",
      });
    });
    expect(latest_state?.sort_state?.column_id).toBe("statistics");

    current_statistics_cache = create_statistics_cache({
      ready: false,
      stale: true,
    });
    await act(async () => {
      root?.render(
        <Probe
          on_ready={(state) => {
            latest_state = state;
          }}
        />,
      );
    });

    expect(latest_state?.statistics_ready).toBe(false);
    expect(latest_state?.sort_state).toBeNull();
    expect(latest_state?.statistics_badge_by_entry_id["foo::0"]?.matched_count).toBe(1);
  });

  it("编辑窗口保存时会先关闭弹窗，不阻塞等待保存回包", async () => {
    await mount_probe();
    api_fetch_mock.mockReturnValueOnce(new Promise(() => {}));

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    expect(latest_state?.dialog_state.open).toBe(true);

    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "bar",
        info: "新规则",
      });
    });

    await act(async () => {
      void latest_state?.save_dialog_entry();
      await Promise.resolve();
    });

    expect(latest_state?.dialog_state.open).toBe(false);
  });
});
