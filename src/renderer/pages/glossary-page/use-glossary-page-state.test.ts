import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@/hooks/use-debounce";
import type { QualityStatisticsCacheSnapshot } from "@/project/quality/quality-statistics-store";
import type { ProjectItemPublicRecord } from "@base/item";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import { buildGlossaryStatisticsState, useGlossaryPageState } from "./use-glossary-page-state";
import type { GlossaryEntry } from "./types";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
  };
});

function create_default_glossary_entries(): GlossaryEntry[] {
  return [
    {
      src: "苹果",
      dst: "Apple",
      info: "水果",
      case_sensitive: false,
    },
  ];
}

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
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

const runtime_state = {
  project: {
    path: "E:/demo/sample.lg",
    loaded: true,
  },
  files: {},
  items: createProjectItemIndex({
    "1": create_test_item({
      item_id: 1,
      file_path: "chapter01.txt",
      src: "苹果真甜",
      dst: "Apple is sweet",
    }),
  }),
  quality: {
    glossary: {
      entries: create_default_glossary_entries(),
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
    status: "idle",
    busy: false,
    progress: {},
    extras: { kind: "analysis", candidate_count: 0 },
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
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState: () => runtime_state,
};

const project_store_listeners = new Set<() => void>();

function apply_quality_mutation_result(result: {
  changes?: Array<{
    projectPath?: string;
    sectionRevisions?: {
      quality?: number;
    };
    operations?: Array<{
      sections?: {
        quality?: {
          data?: typeof runtime_state.quality;
        };
      };
    }>;
  }>;
}): void {
  for (const change of result.changes ?? []) {
    if (change.projectPath !== undefined && change.projectPath !== runtime_state.project.path) {
      continue;
    }

    for (const operation of change.operations ?? []) {
      const next_quality = operation.sections?.quality?.data;
      if (next_quality !== undefined) {
        runtime_state.quality = next_quality;
        if (change.sectionRevisions?.quality !== undefined) {
          runtime_state.revisions.sections.quality = change.sectionRevisions.quality;
        }
        for (const listener of project_store_listeners) {
          listener();
        }
      }
    }
  }
}

// 测试夹具只模拟后端原始 canonical mutation payload，规范化入口仍由页面 hook 真实调用。
function create_quality_mutation_result(
  args: {
    quality?: typeof runtime_state.quality;
    project_path?: string;
    project_revision?: number;
    quality_revision?: number;
  } = {},
) {
  const project_revision = args.project_revision ?? 2;
  return {
    accepted: true,
    changes: [
      {
        source: "quality_rule_save_entries",
        projectPath: args.project_path ?? "E:/demo/sample.lg",
        projectRevision: project_revision,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: args.quality_revision ?? project_revision,
        },
        sections: {
          quality: {
            payloadMode: "canonical-delta",
            data: args.quality ?? runtime_state.quality,
          },
        },
      },
    ],
  };
}

// 质量区块快照由后端整体回灌，测试只替换 glossary 切片以表达该次 mutation 的最终事实。
function create_glossary_quality(
  entries: GlossaryEntry[],
  revision: number,
): typeof runtime_state.quality {
  return {
    ...runtime_state.quality,
    glossary: {
      ...runtime_state.quality.glossary,
      entries,
      revision,
    },
  };
}

let current_statistics_cache: QualityStatisticsCacheSnapshot;
let task_snapshot: { busy: boolean; status: string };

function notify_project_store_listeners(): void {
  for (const listener of project_store_listeners) {
    listener();
  }
}

function create_statistics_cache(
  args: Partial<QualityStatisticsCacheSnapshot>,
): QualityStatisticsCacheSnapshot {
  return {
    phase: "current",
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

function create_statistics_snapshot(
  entry_ids: string[],
): QualityStatisticsCacheSnapshot["completed_snapshot"] {
  return {
    text_source: "src",
    text_signature: "texts",
    dependency_signature: "deps",
    snapshot_signature: `snapshot:${entry_ids.join("|")}`,
    rules: entry_ids.map((entry_id) => {
      return {
        key: entry_id,
        dependency_signature: entry_id,
        relation_label: entry_id,
        token: entry_id,
      };
    }),
  };
}

vi.mock("@/app/desktop/desktop-api", () => {
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

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: runtime_state.project,
      project_store,
      settings_snapshot: {},
      apply_settings_snapshot: vi.fn(),
      apply_project_mutation_result: vi.fn(async (result) => {
        apply_quality_mutation_result(result);
      }),
      refresh_project_runtime: vi.fn(async () => {}),
      task_snapshot,
    }),
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@/project/quality/quality-statistics-context", () => {
  return {
    useQualityStatistics: () => current_statistics_cache,
  };
});

vi.mock("@/app/locale/locale-provider", () => {
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
    project_store_listeners.clear();
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    runtime_state.project.path = "E:/demo/sample.lg";
    runtime_state.project.loaded = true;
    runtime_state.quality.glossary.entries = create_default_glossary_entries();
    runtime_state.quality.glossary.revision = 1;
    runtime_state.revisions.sections.quality = 1;
    current_statistics_cache = create_statistics_cache({});
    task_snapshot = {
      busy: false,
      status: "idle",
    };
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
    vi.useRealTimers();
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

  async function flush_filter_debounce(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
  }

  it("首次进入页面时直接读取预热后的统计结果", async () => {
    await mount_probe();

    expect(latest_state?.statistics_ready).toBe(true);
    expect(latest_state?.statistics_sort_available).toBe(true);
    expect(latest_state?.statistics_badge_by_entry_id["苹果::0"]?.matched_count).toBe(1);
  });

  it("统计刷新中会保留 statistics 排序并继续使用旧统计结果", async () => {
    runtime_state.quality.glossary.entries = [
      {
        src: "苹果",
        dst: "Apple",
        info: "水果",
        case_sensitive: false,
      },
      {
        src: "香蕉",
        dst: "Banana",
        info: "水果",
        case_sensitive: false,
      },
      {
        src: "梨",
        dst: "Pear",
        info: "水果",
        case_sensitive: false,
      },
    ];
    const completed_entry_ids = ["苹果::0", "香蕉::1", "梨::2"];
    const completed_snapshot = create_statistics_snapshot(completed_entry_ids);
    current_statistics_cache = create_statistics_cache({
      current_snapshot: completed_snapshot,
      completed_snapshot,
      completed_entry_ids,
      matched_count_by_entry_id: {
        "苹果::0": 3,
        "香蕉::1": 1,
        "梨::2": 5,
      },
    });
    await mount_probe();

    await act(async () => {
      latest_state?.apply_table_sort_state({
        column_id: "statistics",
        direction: "descending",
      });
    });
    expect(latest_state?.sort_state.field).toBe("statistics");
    expect(latest_state?.filtered_entries.map((entry) => entry.entry_id)).toEqual([
      "梨::2",
      "苹果::0",
      "香蕉::1",
    ]);

    api_fetch_mock.mockResolvedValueOnce(
      create_quality_mutation_result({
        quality: create_glossary_quality(
          [
            {
              entry_id: "苹果::0",
              src: "苹果",
              dst: "Apple",
              info: "水果",
              case_sensitive: false,
            },
            {
              entry_id: "香蕉::1",
              src: "香蕉",
              dst: "Banana",
              info: "水果",
              case_sensitive: false,
            },
          ],
          2,
        ),
      }),
    );
    await act(async () => {
      latest_state?.apply_table_selection({
        selected_row_ids: ["梨::2"],
        active_row_id: "梨::2",
        anchor_row_id: "梨::2",
      });
    });
    await act(async () => {
      await latest_state?.delete_selected_entries();
    });
    await act(async () => {
      await latest_state?.confirm_pending_action();
    });

    current_statistics_cache = create_statistics_cache({
      current_snapshot: completed_snapshot,
      completed_snapshot,
      completed_entry_ids,
      matched_count_by_entry_id: {
        "苹果::0": 3,
        "香蕉::1": 1,
        "梨::2": 5,
      },
      phase: "running",
    });
    await rerender_probe();

    expect(latest_state?.statistics_ready).toBe(false);
    expect(latest_state?.statistics_sort_available).toBe(true);
    expect(latest_state?.sort_state.field).toBe("statistics");
    expect(latest_state?.filtered_entries.map((entry) => entry.entry_id)).toEqual([
      "苹果::0",
      "香蕉::1",
    ]);
    expect(latest_state?.statistics_badge_by_entry_id["苹果::0"]?.matched_count).toBe(3);
  });

  it("首次没有统计快照时不会用空统计结果排序", async () => {
    runtime_state.quality.glossary.entries = [
      {
        src: "苹果",
        dst: "Apple",
        info: "水果",
        case_sensitive: false,
      },
      {
        src: "香蕉",
        dst: "Banana",
        info: "水果",
        case_sensitive: false,
      },
    ];
    current_statistics_cache = create_statistics_cache({
      phase: "empty",
      current_snapshot: null,
      completed_snapshot: null,
      completed_entry_ids: [],
      matched_count_by_entry_id: {},
      subset_parent_labels_by_entry_id: {},
    });
    await mount_probe();

    await act(async () => {
      latest_state?.apply_table_sort_state({
        column_id: "statistics",
        direction: "descending",
      });
    });

    expect(latest_state?.statistics_ready).toBe(false);
    expect(latest_state?.statistics_sort_available).toBe(false);
    expect(latest_state?.filtered_entries.map((entry) => entry.entry_id)).toEqual([
      "苹果::0",
      "香蕉::1",
    ]);
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

  it("新增术语保存成功后立即显示后端回灌的新条目", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce(
      create_quality_mutation_result({
        quality: create_glossary_quality(
          [
            ...create_default_glossary_entries(),
            {
              entry_id: "qr:banana",
              src: "香蕉",
              dst: "Banana",
              info: "水果",
              case_sensitive: false,
            },
          ],
          2,
        ),
      }),
    );

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "香蕉",
        dst: "Banana",
        info: "水果",
      });
    });
    await act(async () => {
      await latest_state?.save_dialog_entry();
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "苹果",
      "香蕉",
    ]);
  });

  it("新增术语保存时即使 SSE 先于 HTTP 返回也立即显示新条目", async () => {
    await mount_probe();
    const mutation_result = create_quality_mutation_result({
      quality: create_glossary_quality(
        [
          ...create_default_glossary_entries(),
          {
            entry_id: "qr:banana",
            src: "香蕉",
            dst: "Banana",
            info: "水果",
            case_sensitive: false,
          },
        ],
        2,
      ),
    });
    let resolve_save: (payload: typeof mutation_result) => void = () => {};
    api_fetch_mock.mockReturnValueOnce(
      new Promise<typeof mutation_result>((resolve) => {
        resolve_save = resolve;
      }),
    );

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "香蕉",
        dst: "Banana",
        info: "水果",
      });
    });

    let save_promise: Promise<void> = Promise.resolve();
    await act(async () => {
      save_promise = latest_state?.save_dialog_entry() ?? Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      apply_quality_mutation_result(mutation_result);
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["苹果"]);

    await act(async () => {
      resolve_save(mutation_result);
      await save_promise;
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "苹果",
      "香蕉",
    ]);
  });

  it("旧项目保存回包不会在新项目事实刷新后重建当前结果成员", async () => {
    await mount_probe();
    const stale_project_mutation_result = create_quality_mutation_result({
      quality: create_glossary_quality(
        [
          ...create_default_glossary_entries(),
          {
            entry_id: "qr:banana",
            src: "香蕉",
            dst: "Banana",
            info: "水果",
            case_sensitive: false,
          },
        ],
        2,
      ),
      quality_revision: 2,
    });
    let resolve_save: (payload: typeof stale_project_mutation_result) => void = () => {};
    api_fetch_mock.mockReturnValueOnce(
      new Promise<typeof stale_project_mutation_result>((resolve) => {
        resolve_save = resolve;
      }),
    );

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "香蕉",
        dst: "Banana",
        info: "水果",
      });
    });

    let save_promise: Promise<void> = Promise.resolve();
    await act(async () => {
      save_promise = latest_state?.save_dialog_entry() ?? Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      runtime_state.project.path = "E:/demo/other.lg";
      runtime_state.quality = create_glossary_quality(
        [
          {
            entry_id: "qr:orange",
            src: "橘子",
            dst: "Orange",
            info: "水果",
            case_sensitive: false,
          },
        ],
        1,
      );
      runtime_state.revisions.sections.quality = 1;
      notify_project_store_listeners();
    });
    await rerender_probe();

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["橘子"]);

    await act(async () => {
      resolve_save(stale_project_mutation_result);
      await save_promise;
    });
    await act(async () => {
      runtime_state.quality = create_glossary_quality(
        [
          {
            entry_id: "qr:orange",
            src: "橘子",
            dst: "Orange",
            info: "水果",
            case_sensitive: false,
          },
          {
            entry_id: "qr:grape",
            src: "葡萄",
            dst: "Grape",
            info: "水果",
            case_sensitive: false,
          },
        ],
        2,
      );
      runtime_state.revisions.sections.quality = 2;
      notify_project_store_listeners();
    });
    await rerender_probe();

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["橘子"]);
  });

  it("保存仅修改翻译或说明时保留旧统计 ready 与 badge", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce(
      create_quality_mutation_result({
        quality: create_glossary_quality(
          [
            {
              entry_id: "苹果::0",
              src: "苹果",
              dst: "Malus",
              info: "新的说明",
              case_sensitive: false,
            },
          ],
          2,
        ),
      }),
    );

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
      expected_section_revisions: { quality: 1 },
      entries: [
        {
          entry_id: "苹果::0",
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

  it("导入遇到重复术语时先确认，跳过只保存非重复条目", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "苹果",
            dst: "Malus",
            info: "新说明",
            case_sensitive: false,
          },
          {
            src: "香蕉",
            dst: "Banana",
            info: "水果",
            case_sensitive: false,
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
          quality: create_glossary_quality(
            [
              {
                entry_id: "苹果::0",
                src: "苹果",
                dst: "Apple",
                info: "水果",
                case_sensitive: false,
              },
              {
                entry_id: "香蕉::1",
                src: "香蕉",
                dst: "Banana",
                info: "水果",
                case_sensitive: false,
              },
            ],
            2,
          ),
        }),
      );

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/glossary.json");
    });

    expect(latest_state?.import_confirm_state.open).toBe(true);
    expect(latest_state?.import_confirm_state.duplicate_count).toBe(1);
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest_state?.import_duplicate_skip();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
      rule_type: "glossary",
      expected_section_revisions: { quality: 1 },
      entries: [
        {
          entry_id: "苹果::0",
          src: "苹果",
          dst: "Apple",
          info: "水果",
          case_sensitive: false,
        },
        {
          entry_id: "香蕉::1",
          src: "香蕉",
          dst: "Banana",
          info: "水果",
          case_sensitive: false,
        },
      ],
    });
    expect(latest_state?.import_confirm_state.open).toBe(false);
  });

  it("导入非重复术语后立即用最新规则重建表格", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "香蕉",
            dst: "Banana",
            info: "水果",
            case_sensitive: false,
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
          quality: create_glossary_quality(
            [
              ...create_default_glossary_entries(),
              {
                entry_id: "香蕉::1",
                src: "香蕉",
                dst: "Banana",
                info: "水果",
                case_sensitive: false,
              },
            ],
            2,
          ),
        }),
      );

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/glossary.json");
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "苹果",
      "香蕉",
    ]);
  });

  it("导入保存失败时恢复原来的冻结结果成员", async () => {
    vi.useFakeTimers();
    await mount_probe();

    await act(async () => {
      latest_state?.update_filter_keyword("苹果");
    });
    expect(latest_state?.filter_state.keyword).toBe("苹果");
    await flush_filter_debounce();
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["苹果"]);

    runtime_state.quality.glossary.entries = [
      ...create_default_glossary_entries(),
      {
        src: "苹果派",
        dst: "Apple pie",
        info: "甜点",
        case_sensitive: false,
      },
    ];
    runtime_state.quality.glossary.revision = 2;
    runtime_state.revisions.sections.quality = 2;
    await rerender_probe();
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["苹果"]);

    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "香蕉",
            dst: "Banana",
            info: "水果",
            case_sensitive: false,
          },
        ],
      })
      .mockRejectedValueOnce(new Error("保存失败"));

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/glossary.json");
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["苹果"]);
  });

  it("导入重复术语确认时基于最新术语表快照重算写入内容", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "苹果",
            dst: "Malus",
            info: "新说明",
            case_sensitive: false,
          },
          {
            src: "香蕉",
            dst: "Banana",
            info: "水果",
            case_sensitive: false,
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
          quality: create_glossary_quality(
            [
              {
                entry_id: "苹果::0",
                src: "苹果",
                dst: "Apple",
                info: "水果",
                case_sensitive: false,
              },
              {
                entry_id: "梨::1",
                src: "梨",
                dst: "Pear",
                info: "水果",
                case_sensitive: false,
              },
              {
                entry_id: "香蕉::2",
                src: "香蕉",
                dst: "Banana",
                info: "水果",
                case_sensitive: false,
              },
            ],
            3,
          ),
          project_revision: 3,
          quality_revision: 3,
        }),
      );

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/glossary.json");
    });

    expect(latest_state?.import_confirm_state.open).toBe(true);

    runtime_state.quality.glossary.entries = [
      {
        src: "苹果",
        dst: "Apple",
        info: "水果",
        case_sensitive: false,
      },
      {
        src: "梨",
        dst: "Pear",
        info: "水果",
        case_sensitive: false,
      },
    ];
    runtime_state.quality.glossary.revision = 2;
    runtime_state.revisions.sections.quality = 2;
    await rerender_probe();

    await act(async () => {
      await latest_state?.import_duplicate_skip();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
      rule_type: "glossary",
      expected_section_revisions: { quality: 2 },
      entries: [
        {
          entry_id: "苹果::0",
          src: "苹果",
          dst: "Apple",
          info: "水果",
          case_sensitive: false,
        },
        {
          entry_id: "梨::1",
          src: "梨",
          dst: "Pear",
          info: "水果",
          case_sensitive: false,
        },
        {
          entry_id: "香蕉::2",
          src: "香蕉",
          dst: "Banana",
          info: "水果",
          case_sensitive: false,
        },
      ],
    });
    expect(latest_state?.import_confirm_state.open).toBe(false);
  });

  it("导入遇到重复术语时覆盖可用新规则改写旧值", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "苹果",
            dst: "",
            info: "",
            case_sensitive: false,
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
          quality: create_glossary_quality(
            [
              {
                entry_id: "苹果::0",
                src: "苹果",
                dst: "",
                info: "",
                case_sensitive: false,
              },
            ],
            2,
          ),
        }),
      );

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/glossary.json");
    });
    await act(async () => {
      await latest_state?.import_duplicate_overwrite();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
      rule_type: "glossary",
      expected_section_revisions: { quality: 1 },
      entries: [
        {
          entry_id: "苹果::0",
          src: "苹果",
          dst: "",
          info: "",
          case_sensitive: false,
        },
      ],
    });
  });

  it("导入重复术语时取消不会写入", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce({
      entries: [
        {
          src: "苹果",
          dst: "Malus",
          info: "新说明",
          case_sensitive: false,
        },
      ],
    });

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/glossary.json");
    });
    await act(async () => {
      latest_state?.close_import_duplicate_confirm();
    });

    expect(latest_state?.import_confirm_state.open).toBe(false);
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
  });

  it("同长度结构性替换不会把旧筛选快照映射到新实体", async () => {
    vi.useFakeTimers();
    runtime_state.quality.glossary.entries = [
      {
        src: "苹果",
        dst: "Apple",
        info: "",
        case_sensitive: false,
      },
      {
        src: "香蕉",
        dst: "Banana",
        info: "",
        case_sensitive: false,
      },
    ];
    await mount_probe();

    act(() => {
      latest_state?.update_filter_keyword("苹果");
    });
    expect(latest_state?.filter_state.keyword).toBe("苹果");
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "苹果",
      "香蕉",
    ]);
    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "苹果",
      "香蕉",
    ]);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["苹果"]);

    runtime_state.quality = {
      ...runtime_state.quality,
      glossary: {
        ...runtime_state.quality.glossary,
        entries: [
          {
            src: "香蕉",
            dst: "Banana",
            info: "",
            case_sensitive: false,
          },
          {
            src: "梨",
            dst: "Pear",
            info: "",
            case_sensitive: false,
          },
        ],
        revision: 2,
      },
    };
    await rerender_probe();

    expect(latest_state?.filter_state.keyword).toBe("苹果");
    expect(latest_state?.filtered_entries).toEqual([]);
  });

  it("任务运行中锁定术语表 mutation，但保留筛选可用", async () => {
    task_snapshot = {
      busy: true,
      status: "running",
    };
    await mount_probe();

    expect(latest_state?.readonly).toBe(true);
    expect(latest_state?.drag_disabled).toBe(true);

    act(() => {
      latest_state?.update_filter_keyword("苹果");
      latest_state?.open_create_dialog();
    });

    expect(latest_state?.filter_state.keyword).toBe("苹果");
    expect(latest_state?.dialog_state.open).toBe(false);

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/glossary.json");
    });

    expect(api_fetch_mock).not.toHaveBeenCalled();
  });
});
