import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QualityStatisticsCacheSnapshot } from "@/app/project/quality/quality-statistics-store";
import { buildGlossaryStatisticsState, useGlossaryPageState } from "./use-glossary-page-state";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
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
      src: "苹果真甜",
      dst: "Apple is sweet",
    },
  },
  quality: {
    glossary: {
      entries: [
        {
          src: "苹果",
          dst: "Apple",
          info: "水果",
          case_sensitive: false,
        },
      ],
      enabled: true,
      mode: "custom",
      revision: 1,
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
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
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
          key: "苹果::0",
          dependency_signature: "苹果",
          relation_label: "苹果",
          token: "苹果",
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
          key: "苹果::0",
          dependency_signature: "苹果",
          relation_label: "苹果",
          token: "苹果",
        },
      ],
    },
    completed_entry_ids: ["苹果::0"],
    matched_count_by_entry_id: {
      "苹果::0": 1,
    },
    subset_parent_labels_by_entry_id: {
      "苹果::0": [],
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

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
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
  render_version: number;
  on_ready: (state: ReturnType<typeof useGlossaryPageState>) => void;
}): null {
  const state = useGlossaryPageState();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("buildGlossaryStatisticsState", () => {
  it("把统计结果映射成按条目索引的状态", () => {
    const state = buildGlossaryStatisticsState({
      snapshot: {
        text_source: "src",
        text_signature: "texts",
        dependency_signature: "deps",
        snapshot_signature: "snapshot",
        rules: [
          {
            key: "苹果|1",
            dependency_signature: "苹果",
            relation_label: "苹果",
            token: "苹果",
          },
        ],
      },
      completed_entry_ids: ["苹果|1"],
      results: {
        "苹果|1": {
          matched_item_count: 1,
          subset_parents: [],
        },
      },
    });

    expect(state.completed_snapshot?.snapshot_signature).toBe("snapshot");
    expect(state.matched_count_by_entry_id["苹果|1"]).toBe(1);
  });
});

describe("useGlossaryPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useGlossaryPageState> | null = null;
  let render_version = 0;

  beforeEach(() => {
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    current_statistics_cache = create_statistics_cache({});
    render_version = 0;
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

    await rerender_probe();
  }

  async function rerender_probe(): Promise<void> {
    render_version += 1;
    await act(async () => {
      root?.render(
        createElement(Probe, {
          render_version,
          on_ready: (state) => {
            latest_state = state;
          },
        }),
      );
    });
  }

  it("首次进入页面时直接读取预热后的统计结果", async () => {
    await mount_probe();

    expect(latest_state?.statistics_ready).toBe(true);
    expect(latest_state?.statistics_badge_by_entry_id["苹果::0"]?.matched_count).toBe(1);
  });

  it("统计失效后会清空 statistics 排序", async () => {
    await mount_probe();

    await act(async () => {
      latest_state?.apply_table_sort_state({
        column_id: "statistics",
        direction: "descending",
      });
    });
    expect(latest_state?.sort_state.field).toBe("statistics");

    current_statistics_cache = create_statistics_cache({
      ready: false,
      stale: true,
    });
    await rerender_probe();

    expect(latest_state?.statistics_ready).toBe(false);
    expect(latest_state?.sort_state.field).toBeNull();
    expect(latest_state?.statistics_badge_by_entry_id["苹果::0"]?.matched_count).toBe(1);
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
        src: "香蕉",
        dst: "Banana",
        info: "水果",
      });
    });

    await act(async () => {
      void latest_state?.save_dialog_entry();
      await Promise.resolve();
    });

    expect(latest_state?.dialog_state.open).toBe(false);
  });

  it("保存仅修改翻译或说明时保留旧统计 ready 与 badge", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce({
      accepted: true,
      projectRevision: 2,
      sectionRevisions: {
        quality: 2,
      },
    });

    expect(latest_state?.statistics_ready).toBe(true);
    expect(latest_state?.statistics_badge_by_entry_id["苹果::0"]?.matched_count).toBe(1);

    await act(async () => {
      latest_state?.open_edit_dialog("苹果::0");
    });

    await act(async () => {
      latest_state?.update_dialog_draft({
        dst: "Malus",
        info: "新的说明",
      });
    });

    await act(async () => {
      await latest_state?.save_dialog_entry();
    });

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/save-entries", {
      rule_type: "glossary",
      expected_revision: 1,
      entries: [
        {
          src: "苹果",
          dst: "Malus",
          info: "新的说明",
          case_sensitive: false,
        },
      ],
    });
    expect(latest_state?.statistics_ready).toBe(true);
    expect(latest_state?.statistics_badge_by_entry_id["苹果::0"]?.matched_count).toBe(1);
  });
});
