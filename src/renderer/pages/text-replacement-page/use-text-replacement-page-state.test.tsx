import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@/hooks/use-debounce";
import type { QualityRuleStatisticsCacheSnapshot } from "@/project/quality/quality-statistics-store";
import type { ProjectItemPublicRecord } from "@domain/item";
import { createProjectItemIndex } from "@/project/project-item-index";
import { useTextReplacementPageState } from "@/pages/text-replacement-page/use-text-replacement-page-state";

const { api_fetch_mock, push_toast_mock, page_ui_state_store } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
    page_ui_state_store: new Map<string, unknown>(),
  };
});

// create_test_item 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
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
      src: "hero appears",
      dst: "hero 登场",
    }),
  }),
  quality: {
    glossary: {
      entries: [],
      enabled: false,
      mode: "off",
      revision: 0,
    },
    pre_replacement: {
      entries: [
        {
          entry_id: "hero::0",
          src: "hero",
          dst: "勇者",
          regex: false,
          case_sensitive: false,
        },
      ],
      enabled: true,
      mode: "custom",
      revision: 2,
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
      quality: 2,
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

// apply_quality_mutation_result 收口测试中的共享步骤，保证断言只关注当前行为。
/**
 * 写入当前场景的状态变化。
 */
function apply_quality_mutation_result(result: {
  changes?: Array<{
    sectionRevisions?: {
      quality?: number;
    };
    sections?: {
      quality?: {
        data?: typeof runtime_state.quality;
      };
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
    const canonical_quality = change.sections?.quality?.data;
    if (canonical_quality !== undefined) {
      runtime_state.quality = canonical_quality;
      if (change.sectionRevisions?.quality !== undefined) {
        runtime_state.revisions.sections.quality = change.sectionRevisions.quality;
      }
      for (const listener of project_store_listeners) {
        listener();
      }
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

// 测试夹具只模拟后端原始 canonical mutation payload，回灌入口由运行态 commit mock 触发。
/**
 * 构造当前测试场景的标准数据。
 */
function create_quality_mutation_result(
  args: {
    quality?: typeof runtime_state.quality;
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
        projectPath: "E:/demo/sample.lg",
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

// 质量区块快照由后端整体回灌，测试只替换 pre_replacement 切片以表达保存后的事实。
/**
 * 构造当前测试场景的标准数据。
 */
function create_pre_replacement_quality(
  entries: typeof runtime_state.quality.pre_replacement.entries,
  revision: number,
): typeof runtime_state.quality {
  return {
    ...runtime_state.quality,
    pre_replacement: {
      ...runtime_state.quality.pre_replacement,
      entries,
      revision,
    },
  };
}

let current_statistics_cache: QualityRuleStatisticsCacheSnapshot;
let project_change_seq = 0;

// create_statistics_cache 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
function create_statistics_cache(
  args: Partial<QualityRuleStatisticsCacheSnapshot>,
): QualityRuleStatisticsCacheSnapshot {
  return {
    phase: "current",
    current_snapshot: {
      text_source: "src",
      text_signature: "texts",
      dependency_signature: "deps",
      snapshot_signature: "snapshot",
      rules: [
        {
          key: "hero::0",
          dependency_signature: "hero",
          relation_label: "hero",
          token: "hero",
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
          key: "hero::0",
          dependency_signature: "hero",
          relation_label: "hero",
          token: "hero",
        },
      ],
    },
    completed_entry_ids: ["hero::0"],
    matched_count_by_entry_id: {
      "hero::0": 1,
    },
    subset_parent_labels_by_entry_id: {
      "hero::0": [],
    },
    last_error: null,
    request_token: 1,
    updated_at: 1,
    ...args,
  };
}

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    report_renderer_error: vi.fn(async () => undefined),
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

vi.mock("@/project/query/quality-rule-query", () => {
  return {
    read_project_quality_rule: vi.fn(async (rule_type: keyof typeof runtime_state.quality) => ({
      projectPath: runtime_state.project.path,
      sectionRevisions: { ...runtime_state.revisions.sections },
      qualityRule: runtime_state.quality[rule_type],
    })),
  };
});

vi.mock("@/project/query/project-section-revisions-query", () => {
  return {
    read_project_section_revisions: vi.fn(async () => ({
      ...runtime_state.revisions.sections,
    })),
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: runtime_state.project,
      project_change_signal: {
        seq: project_change_seq,
        reason: "test",
        updated_sections: ["quality"],
        results: [],
      },
      project_store,
      settings_snapshot: {},
      apply_settings_snapshot: vi.fn(),
      commit_project_mutation: vi.fn(async (request) => {
        const payload = await request.run();
        const mutation_result = {
          accepted: true,
          changes: Array.isArray(payload.changes) ? payload.changes : [],
        };
        await request.prepare?.({ payload, mutation_result });
        apply_quality_mutation_result(mutation_result);
        return {
          payload,
          mutation_result,
        };
      }),
      refresh_project_runtime: vi.fn(async () => {}),
      task_snapshot: runtime_state.task,
    }),
  };
});

vi.mock("@/app/ui-runtime/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@/project/quality/quality-statistics-context", () => {
  return {
    useQualityRuleStatistics: () => current_statistics_cache,
  };
});

vi.mock("@/app/session/project-session-ui-state-context", async () => {
  const React = await import("react");
  const resolve_restore_scroll_row_id = (
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
  };

  return {
    resolve_project_session_table_restore_scroll_row_id: resolve_restore_scroll_row_id,
    useProjectSessionTableUiState: (options: {
      key: string;
      create_default_filter_state: () => unknown;
      create_default_sort_state: () => unknown;
      clone_filter_state: (filter_state: never) => unknown;
      normalize_sort_state: (sort_state: never) => unknown;
    }) => {
      const {
        key,
        create_default_filter_state,
        create_default_sort_state,
        clone_filter_state,
        normalize_sort_state,
      } = options;
      const stored_ui_state = page_ui_state_store.get(key) as
        | {
            filter_state: never;
            sort_state: never;
            selected_row_ids: string[];
            active_row_id: string | null;
            anchor_row_id: string | null;
          }
        | undefined;
      const [filter_state, set_filter_state_snapshot] = React.useState(() => {
        return stored_ui_state === undefined
          ? create_default_filter_state()
          : clone_filter_state(stored_ui_state.filter_state);
      });
      const [sort_state, set_sort_state_snapshot] = React.useState(() => {
        return stored_ui_state === undefined
          ? create_default_sort_state()
          : normalize_sort_state(stored_ui_state.sort_state);
      });
      const [selected_row_ids, set_selected_row_ids] = React.useState(
        () => stored_ui_state?.selected_row_ids ?? [],
      );
      const [active_row_id, set_active_row_id] = React.useState(
        () => stored_ui_state?.active_row_id ?? null,
      );
      const [anchor_row_id, set_anchor_row_id] = React.useState(
        () => stored_ui_state?.anchor_row_id ?? null,
      );
      const [restore_scroll_row_id, set_restore_scroll_row_id] = React.useState(() => {
        return resolve_restore_scroll_row_id(stored_ui_state ?? null);
      });
      const filter_state_ref = React.useRef(filter_state);
      const sort_state_ref = React.useRef(sort_state);
      const selected_row_ids_ref = React.useRef(selected_row_ids);
      const active_row_id_ref = React.useRef(active_row_id);
      const anchor_row_id_ref = React.useRef(anchor_row_id);
      const write_page_ui_state = React.useCallback(
        (patch: Record<string, unknown> = {}): void => {
          const next_filter_state =
            "filter_state" in patch ? patch.filter_state : filter_state_ref.current;
          const next_sort_state = "sort_state" in patch ? patch.sort_state : sort_state_ref.current;
          const next_selected_row_ids =
            "selected_row_ids" in patch ? patch.selected_row_ids : selected_row_ids_ref.current;
          const next_active_row_id =
            "active_row_id" in patch ? patch.active_row_id : active_row_id_ref.current;
          const next_anchor_row_id =
            "anchor_row_id" in patch ? patch.anchor_row_id : anchor_row_id_ref.current;
          page_ui_state_store.set(key, {
            filter_state: next_filter_state,
            sort_state: next_sort_state,
            selected_row_ids: next_selected_row_ids,
            active_row_id: next_active_row_id,
            anchor_row_id: next_anchor_row_id,
          });
        },
        [key],
      );
      const set_filter_state = React.useCallback(
        (next_filter_state: never): void => {
          const cloned_filter_state = clone_filter_state(next_filter_state);
          filter_state_ref.current = cloned_filter_state;
          set_filter_state_snapshot(cloned_filter_state);
          write_page_ui_state({ filter_state: cloned_filter_state });
        },
        [clone_filter_state, write_page_ui_state],
      );
      const set_sort_state = React.useCallback(
        (next_sort_state: never): void => {
          const normalized_sort_state = normalize_sort_state(next_sort_state);
          sort_state_ref.current = normalized_sort_state;
          set_sort_state_snapshot(normalized_sort_state);
          write_page_ui_state({ sort_state: normalized_sort_state });
        },
        [normalize_sort_state, write_page_ui_state],
      );
      const set_selection_state = React.useCallback(
        (selection_state: {
          selected_row_ids: string[];
          active_row_id: string | null;
          anchor_row_id: string | null;
        }): void => {
          const next_selected_row_ids = [...selection_state.selected_row_ids];
          selected_row_ids_ref.current = next_selected_row_ids;
          active_row_id_ref.current = selection_state.active_row_id;
          anchor_row_id_ref.current = selection_state.anchor_row_id;
          set_selected_row_ids(next_selected_row_ids);
          set_active_row_id(selection_state.active_row_id);
          set_anchor_row_id(selection_state.anchor_row_id);
          set_restore_scroll_row_id(null);
          write_page_ui_state({
            selected_row_ids: next_selected_row_ids,
            active_row_id: selection_state.active_row_id,
            anchor_row_id: selection_state.anchor_row_id,
          });
        },
        [write_page_ui_state],
      );
      const clear_selection_state = React.useCallback((): void => {
        set_selection_state({
          selected_row_ids: [],
          active_row_id: null,
          anchor_row_id: null,
        });
      }, [set_selection_state]);
      const reset_table_state = React.useCallback((): void => {
        const next_filter_state = clone_filter_state(create_default_filter_state() as never);
        const next_sort_state = normalize_sort_state(create_default_sort_state() as never);
        filter_state_ref.current = next_filter_state;
        sort_state_ref.current = next_sort_state;
        selected_row_ids_ref.current = [];
        active_row_id_ref.current = null;
        anchor_row_id_ref.current = null;
        set_filter_state_snapshot(next_filter_state);
        set_sort_state_snapshot(next_sort_state);
        set_selected_row_ids([]);
        set_active_row_id(null);
        set_anchor_row_id(null);
        set_restore_scroll_row_id(null);
      }, [
        clone_filter_state,
        create_default_filter_state,
        create_default_sort_state,
        normalize_sort_state,
      ]);
      return {
        filter_state,
        sort_state,
        selected_row_ids,
        active_row_id,
        anchor_row_id,
        restore_scroll_row_id,
        set_filter_state,
        set_sort_state,
        set_selection_state,
        clear_selection_state,
        restore_selection_state: set_selection_state,
        reset_table_state,
        write_page_ui_state,
      };
    },
    useProjectSessionUiState: () => ({
      get_page_ui_state: <UiState,>(key: string): UiState | null => {
        return (page_ui_state_store.get(key) as UiState | undefined) ?? null;
      },
      set_page_ui_state: <UiState,>(key: string, ui_state: UiState): void => {
        page_ui_state_store.set(key, ui_state);
      },
      update_page_ui_state: <UiState,>(
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

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

// Probe 收口测试中的共享步骤，保证断言只关注当前行为。
function Probe(props: {
  on_ready: (state: ReturnType<typeof useTextReplacementPageState>) => void;
}): JSX.Element | null {
  const state = useTextReplacementPageState("pre");

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useTextReplacementPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useTextReplacementPageState> | null = null;

  beforeEach(() => {
    project_store_listeners.clear();
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    project_change_seq = 0;
    runtime_state.task.busy = false;
    runtime_state.task.status = "idle";
    page_ui_state_store.clear();
    runtime_state.quality.pre_replacement = {
      entries: [
        {
          entry_id: "hero::0",
          src: "hero",
          dst: "勇者",
          regex: false,
          case_sensitive: false,
        },
      ],
      enabled: true,
      mode: "custom",
      revision: 2,
    };
    runtime_state.revisions.sections.quality = 2;
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
    vi.useRealTimers();
  });

  // mount_probe 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 挂载当前测试组件并等待渲染完成。
   */
  async function mount_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await rerender_probe();
  }

  // rerender_probe 收口测试中的共享步骤，保证断言只关注当前行为。
  /**
   * 支撑当前测试场景的专用辅助逻辑。
   */
  async function rerender_probe(): Promise<void> {
    project_change_seq += 1;
    await act(async () => {
      root?.render(
        <Probe
          on_ready={(state) => {
            latest_state = state;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  // flush_filter_debounce 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 支撑当前测试场景的专用辅助逻辑。
   */
  async function flush_filter_debounce(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
  }

  it("首次进入页面时直接读取预热后的统计结果", async () => {
    await mount_probe();

    expect(latest_state?.statistics_ready).toBe(true);
    expect(latest_state?.statistics_badge_by_entry_id["hero::0"]?.matched_count).toBe(1);
  });

  it("统计未 ready 时不会启用 statistics 排序", async () => {
    await mount_probe();

    await act(async () => {
      latest_state?.apply_table_sort_state({
        column_id: "statistics",
        direction: "descending",
      });
    });
    expect(latest_state?.sort_state?.column_id).toBe("statistics");

    current_statistics_cache = create_statistics_cache({
      phase: "running",
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
    expect(latest_state?.statistics_badge_by_entry_id["hero::0"]?.matched_count).toBe(1);
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
        src: "mage",
        dst: "法师",
      });
    });

    await act(async () => {
      void latest_state?.save_dialog_entry();
      await Promise.resolve();
    });

    expect(latest_state?.dialog_state.open).toBe(false);
  });

  it("新增替换规则保存成功后立即显示后端回灌的新条目", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce(
      create_quality_mutation_result({
        quality: create_pre_replacement_quality(
          [
            {
              entry_id: "hero::0",
              src: "hero",
              dst: "勇者",
              regex: false,
              case_sensitive: false,
            },
            {
              entry_id: "qr:mage",
              src: "mage",
              dst: "法师",
              regex: false,
              case_sensitive: false,
            },
          ],
          3,
        ),
        quality_revision: 3,
      }),
    );

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "mage",
        dst: "法师",
      });
    });
    await act(async () => {
      await latest_state?.save_dialog_entry();
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "hero",
      "mage",
    ]);
  });

  it("新增替换规则保存时若 SSE 先于 HTTP 返回，最终仍由统一 commit 回灌新条目", async () => {
    await mount_probe();
    const mutation_result = create_quality_mutation_result({
      quality: create_pre_replacement_quality(
        [
          {
            entry_id: "hero::0",
            src: "hero",
            dst: "勇者",
            regex: false,
            case_sensitive: false,
          },
          {
            entry_id: "qr:mage",
            src: "mage",
            dst: "法师",
            regex: false,
            case_sensitive: false,
          },
        ],
        3,
      ),
      quality_revision: 3,
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
        src: "mage",
        dst: "法师",
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

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["hero"]);

    await act(async () => {
      resolve_save(mutation_result);
      await save_promise;
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "hero",
      "mage",
    ]);
  });

  it("导入重复替换规则时跳过只保存非重复规则", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "hero",
            dst: "英雄",
            regex: false,
            case_sensitive: false,
          },
          {
            src: "mage",
            dst: "法师",
            regex: false,
            case_sensitive: false,
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
          quality: create_pre_replacement_quality(
            [
              {
                entry_id: "hero::0",
                src: "hero",
                dst: "勇者",
                regex: false,
                case_sensitive: false,
              },
              {
                entry_id: "mage::1",
                src: "mage",
                dst: "法师",
                regex: false,
                case_sensitive: false,
              },
            ],
            3,
          ),
          quality_revision: 3,
        }),
      );

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/replacement.json");
    });

    expect(latest_state?.import_confirm_state.open).toBe(true);
    expect(latest_state?.import_confirm_state.duplicate_count).toBe(1);
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest_state?.import_duplicate_skip();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
      rule_type: "pre_replacement",
      expected_section_revisions: { quality: 2 },
      entries: [
        {
          entry_id: "hero::0",
          src: "hero",
          dst: "勇者",
          regex: false,
          case_sensitive: false,
        },
        {
          entry_id: "mage::1",
          src: "mage",
          dst: "法师",
          regex: false,
          case_sensitive: false,
        },
      ],
    });
  });

  it("导入非重复替换规则后立即用最新规则重建表格", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "mage",
            dst: "法师",
            regex: false,
            case_sensitive: false,
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
          quality: create_pre_replacement_quality(
            [
              {
                entry_id: "hero::0",
                src: "hero",
                dst: "勇者",
                regex: false,
                case_sensitive: false,
              },
              {
                entry_id: "mage::1",
                src: "mage",
                dst: "法师",
                regex: false,
                case_sensitive: false,
              },
            ],
            3,
          ),
          quality_revision: 3,
        }),
      );

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/replacement.json");
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual([
      "hero",
      "mage",
    ]);
  });

  it("导入保存失败时恢复原来的冻结结果成员", async () => {
    vi.useFakeTimers();
    await mount_probe();

    await act(async () => {
      latest_state?.update_filter_keyword("hero");
    });
    expect(latest_state?.filter_state.keyword).toBe("hero");
    await flush_filter_debounce();
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["hero"]);

    runtime_state.quality.pre_replacement.entries = [
      {
        entry_id: "hero::0",
        src: "hero",
        dst: "勇者",
        regex: false,
        case_sensitive: false,
      },
      {
        entry_id: "heroine::1",
        src: "heroine",
        dst: "女主角",
        regex: false,
        case_sensitive: false,
      },
    ];
    runtime_state.quality.pre_replacement.revision = 3;
    runtime_state.revisions.sections.quality = 3;
    await rerender_probe();
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["hero"]);

    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "mage",
            dst: "法师",
            regex: false,
            case_sensitive: false,
          },
        ],
      })
      .mockRejectedValueOnce(new Error("保存失败"));

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/replacement.json");
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["hero"]);
  });

  it("预设重复替换规则选择覆盖时会保存新规则", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "hero",
            dst: "",
            regex: true,
            case_sensitive: true,
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
          quality: create_pre_replacement_quality(
            [
              {
                entry_id: "hero::0",
                src: "hero",
                dst: "",
                regex: true,
                case_sensitive: true,
              },
            ],
            3,
          ),
          quality_revision: 3,
        }),
      );

    await act(async () => {
      await latest_state?.apply_preset("builtin:demo.json");
    });
    await act(async () => {
      await latest_state?.import_duplicate_overwrite();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
      rule_type: "pre_replacement",
      expected_section_revisions: { quality: 2 },
      entries: [
        {
          entry_id: "hero::0",
          src: "hero",
          dst: "",
          regex: true,
          case_sensitive: true,
        },
      ],
    });
  });

  it("任务运行中锁定替换规则 mutation，但保留筛选可用", async () => {
    runtime_state.task.busy = true;
    runtime_state.task.status = "running";
    await mount_probe();

    expect(latest_state?.readonly).toBe(true);
    expect(latest_state?.drag_disabled).toBe(true);

    await act(async () => {
      latest_state?.open_create_dialog();
      await latest_state?.update_enabled(false);
      latest_state?.update_filter_keyword("hero");
    });

    expect(latest_state?.dialog_state.open).toBe(false);
    expect(latest_state?.filter_state.keyword).toBe("hero");
    expect(api_fetch_mock).not.toHaveBeenCalled();
  });

  it("重新进入替换规则页时保留搜索排序和选中位置", async () => {
    runtime_state.quality.pre_replacement.entries = [
      {
        entry_id: "hero::0",
        src: "hero",
        dst: "勇者",
        regex: false,
        case_sensitive: false,
      },
      {
        entry_id: "mage::1",
        src: "mage",
        dst: "法师",
        regex: false,
        case_sensitive: false,
      },
    ];
    await mount_probe();

    await act(async () => {
      latest_state?.update_filter_keyword("hero");
      latest_state?.apply_table_sort_state({
        column_id: "dst",
        direction: "descending",
      });
      latest_state?.apply_table_selection({
        selected_row_ids: ["hero::0"],
        active_row_id: "hero::0",
        anchor_row_id: "hero::0",
      });
    });

    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;

    await mount_probe();

    expect(latest_state?.filter_state.keyword).toBe("hero");
    expect(latest_state?.sort_state).toEqual({
      column_id: "dst",
      direction: "descending",
    });
    expect(latest_state?.selected_entry_ids).toEqual(["hero::0"]);
    expect(latest_state?.active_entry_id).toBe("hero::0");
    expect(latest_state?.restore_scroll_entry_id).toBe("hero::0");
  });
});
