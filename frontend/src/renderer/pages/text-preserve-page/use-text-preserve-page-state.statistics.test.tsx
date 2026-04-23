import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QualityStatisticsCacheSnapshot } from "@/app/project-runtime/quality-statistics-store";
import { useTextPreservePageState } from "@/pages/text-preserve-page/use-text-preserve-page-state";

const {
  api_fetch_mock,
  push_toast_mock,
  wait_for_barrier_mock,
  create_barrier_checkpoint_mock,
  run_modal_progress_toast_mock,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
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

const project_store = {
  subscribe: vi.fn(() => {
    return () => {};
  }),
  getState: () => runtime_state,
};

let current_statistics_cache: QualityStatisticsCacheSnapshot;

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
          key: "^foo\\d+$::0",
          dependency_signature: "^foo\\d+$",
          relation_label: "^foo\\d+$",
          token: "^foo\\d+$",
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
          key: "^foo\\d+$::0",
          dependency_signature: "^foo\\d+$",
          relation_label: "^foo\\d+$",
          token: "^foo\\d+$",
        },
      ],
    },
    completed_entry_ids: ["^foo\\d+$::0"],
    matched_count_by_entry_id: {
      "^foo\\d+$::0": 1,
    },
    subset_parent_labels_by_entry_id: {
      "^foo\\d+$::0": [],
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
      commit_local_project_patch: vi.fn(() => ({
        rollback: vi.fn(),
      })),
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

vi.mock("@/app/state/quality-statistics-context", () => {
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

describe("useTextPreservePageState statistics", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useTextPreservePageState> | null = null;

  beforeEach(() => {
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
    current_statistics_cache = create_statistics_cache({});
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

  it("首次进入页面时直接读取预热后的统计结果", async () => {
    await mount_probe();

    expect(latest_state?.statistics_ready).toBe(true);
    expect(latest_state?.statistics_badge_by_entry_id["^foo\\d+$::0"]?.matched_count).toBe(1);
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
    expect(latest_state?.statistics_badge_by_entry_id["^foo\\d+$::0"]?.matched_count).toBe(1);
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
});
