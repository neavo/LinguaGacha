import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@frontend/widgets/interactions/use-debounce";
import type { QualityRuleStatisticsCacheSnapshot } from "@frontend/app/session/quality-rule-statistics-store";
import { useTextPreservePageState } from "./use-text-preserve-page-state";

const {
  api_fetch_mock,
  push_toast_mock,
  query_quality_rules_mock,
  translate_mock,
  page_ui_state_store,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
    query_quality_rules_mock: vi.fn(),
    translate_mock: (key: string) => key,
    page_ui_state_store: new Map<string, unknown>(),
  };
});

const run_modal_progress_toast_mock = vi.fn(
  async <T,>(args: { task: () => Promise<T> }): Promise<T> => {
    return args.task();
  },
);

let run_state = {
  project: {
    path: "E:/demo/sample.lg",
    loaded: true,
  },
  files: {},
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

type TextPreserveRuleEntry = (typeof run_state.quality.text_preserve.entries)[number] & {
  entry_id?: string;
};

/**
 * 模拟后端 change 回流，把权威 quality 切片合并进测试项目仓库。
 */
function apply_quality_write_result(result: {
  changes?: Array<{
    sectionRevisions?: {
      quality?: number;
    };
    sections?: {
      quality?: {
        data?: typeof run_state.quality;
      };
    };
    operations?: Array<{
      sections?: {
        quality?: {
          data?: typeof run_state.quality;
        };
      };
    }>;
  }>;
}): void {
  for (const change of result.changes ?? []) {
    const canonical_quality = change.sections?.quality?.data;
    if (canonical_quality !== undefined) {
      run_state = {
        ...run_state,
        quality: canonical_quality,
        revisions: {
          ...run_state.revisions,
          sections: {
            ...run_state.revisions.sections,
            ...(change.sectionRevisions?.quality === undefined
              ? {}
              : { quality: change.sectionRevisions.quality }),
          },
        },
      };
      for (const listener of project_store_listeners) {
        listener();
      }
      continue;
    }

    for (const operation of change.operations ?? []) {
      const next_quality = operation.sections?.quality?.data;
      if (next_quality !== undefined) {
        run_state = {
          ...run_state,
          quality: next_quality,
          revisions: {
            ...run_state.revisions,
            sections: {
              ...run_state.revisions.sections,
              ...(change.sectionRevisions?.quality === undefined
                ? {}
                : { quality: change.sectionRevisions.quality }),
            },
          },
        };
        for (const listener of project_store_listeners) {
          listener();
        }
      }
    }
  }
}

// 测试夹具只模拟后端原始规范化写入载荷，回灌入口由运行态 commit mock 触发。
function create_quality_write_result(
  args: {
    quality?: typeof run_state.quality;
    project_revision?: number;
    quality_revision?: number;
  } = {},
) {
  const project_revision = args.project_revision ?? 2;
  return {
    accepted: true,
    changes: [
      {
        source: "quality_rule_update",
        projectPath: "E:/demo/sample.lg",
        projectRevision: project_revision,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: args.quality_revision ?? project_revision,
        },
        sections: {
          quality: {
            payloadMode: "canonical-delta",
            data: args.quality ?? run_state.quality,
          },
        },
      },
    ],
  };
}

// 文本保护规则保存只改变 text_preserve 切片，测试显式写出后端回灌后的完整质量事实。
function create_text_preserve_quality(
  entries: TextPreserveRuleEntry[],
  revision: number,
): typeof run_state.quality {
  return {
    ...run_state.quality,
    text_preserve: {
      ...run_state.quality.text_preserve,
      entries,
      revision,
    },
  };
}

const project_store = {
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState: () => run_state,
};

let current_hit_cache: QualityRuleStatisticsCacheSnapshot;
let runtime_snapshot: { revision: number; owner: "task" | "agent" | null };
let project_change_seq = 0;
let project_change_sections: Array<"items" | "quality"> = ["quality"];

function create_hit_cache(
  args: Partial<QualityRuleStatisticsCacheSnapshot>,
): QualityRuleStatisticsCacheSnapshot {
  return {
    phase: "current",
    entry_ids: ["foo::0"],
    hits_by_entry_id: {
      "foo::0": 1,
    },
    subset_parents_by_entry_id: {
      "foo::0": [],
    },
    last_error: null,
    request_token: 1,
    updated_at: 1,
    ...args,
  };
}

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    report_renderer_error: vi.fn(async () => undefined),
  };
});

vi.mock("@frontend/features/quality-rule-editor/quality-rule-api-client", async (import_actual) => {
  const actual =
    await import_actual<
      typeof import("@frontend/features/quality-rule-editor/quality-rule-api-client")
    >();
  return {
    ...actual,
    query_quality_rules: query_quality_rules_mock,
  };
});

vi.mock("@frontend/app/session/project-session-ui-state-context", async () => {
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

vi.mock("@frontend/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => ({
      navigate_to_route: vi.fn(),
      push_proofreading_lookup_intent: vi.fn(),
    }),
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => ({
      project_snapshot: {
        loaded: true,
        path: "E:/demo/sample.lg",
      },
      project_change_signal: {
        seq: project_change_seq,
        reason: "test",
        updated_sections: project_change_sections,
        results: [],
      },
      project_store,
      settings_snapshot: {},
      apply_settings_snapshot: vi.fn(),
      refresh_project_state: vi.fn(async () => {}),
      runtime_snapshot,
      commit_project_write: vi.fn(async (request) => {
        const payload = await request.run();
        const write_result = {
          accepted: true,
          changes: Array.isArray(payload.changes) ? payload.changes : [],
        };
        await request.prepare?.({ payload, write_result });
        apply_quality_write_result(write_result);
        return {
          payload,
          write_result,
        };
      }),
    }),
    useProjectChangeSignal: () => ({
      seq: project_change_seq,
      reason: "test",
      updated_sections: project_change_sections,
      results: [],
    }),
    useRuntimeSnapshot: () => runtime_snapshot,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      run_modal_progress_toast: run_modal_progress_toast_mock,
    }),
  };
});

vi.mock("@frontend/app/session/quality-rule-statistics-context", () => {
  return {
    useQualityRuleStatistics: () => current_hit_cache,
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: translate_mock,
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
    query_quality_rules_mock.mockReset();
    query_quality_rules_mock.mockImplementation(
      async (rule_type: keyof typeof run_state.quality) => ({
        projectPath: run_state.project.path,
        sectionRevisions: { ...run_state.revisions.sections },
        qualityRule: run_state.quality[rule_type],
      }),
    );
    current_hit_cache = create_hit_cache({});
    project_change_sections = ["quality"];
    runtime_snapshot = { revision: 0, owner: null };
    page_ui_state_store.clear();
    run_state = {
      ...run_state,
      quality: {
        ...run_state.quality,
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
      revisions: {
        ...run_state.revisions,
        sections: {
          ...run_state.revisions.sections,
          quality: 1,
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
    run_modal_progress_toast_mock.mockClear();
    project_change_seq = 0;
    vi.useRealTimers();
  });

  async function mount_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await rerender_probe();
  }

  // 递增项目 change seq，模拟后端事件驱动页面刷新。
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

  async function flush_filter_debounce(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
  }

  it("提交模式时沿用生成当前文本保护事实的旧 revision", async () => {
    await mount_probe();
    run_state.revisions.sections.quality = 9;
    api_fetch_mock.mockResolvedValueOnce(
      create_quality_write_result({
        quality: {
          ...run_state.quality,
          text_preserve: {
            ...run_state.quality.text_preserve,
            mode: "smart",
            revision: 2,
          },
        },
        quality_revision: 2,
      }),
    );

    await act(async () => {
      await latest_state?.update_mode("smart");
    });

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/rules/update", {
      rule_type: "text_preserve",
      expected_section_revisions: { quality: 1 },
      meta: { mode: "smart" },
    });
  });

  it("模式切换成功后直接收敛到后端已提交模式", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/workbench/snapshot") {
        return {
          sectionRevisions: {
            quality: 1,
          },
        };
      }
      return {
        accepted: true,
        changes: [
          {
            source: "quality_rule_update",
            projectPath: "E:/demo/sample.lg",
            projectRevision: 2,
            updatedSections: ["quality"],
            sectionRevisions: {
              quality: 2,
            },
            sections: {
              quality: {
                payloadMode: "canonical-delta",
                data: {
                  ...run_state.quality,
                  text_preserve: {
                    ...run_state.quality.text_preserve,
                    mode: "smart",
                    revision: 2,
                  },
                },
              },
            },
          },
        ],
      };
    });

    await mount_probe();
    if (latest_state === null) {
      throw new Error("文本保护页面状态未准备就绪。");
    }

    await act(async () => {
      await latest_state!.update_mode("smart");
    });

    expect(latest_state?.mode).toBe("smart");
    expect(latest_state?.mode_updating).toBe(false);
    expect(push_toast_mock).toHaveBeenCalledWith("success", "app.feedback.feature_state_changed");
  });

  it("模式切换失败时不显示成功提醒", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/workbench/snapshot") {
        return {
          sectionRevisions: {
            quality: 1,
          },
        };
      }
      throw new Error("保存失败");
    });

    await mount_probe();
    if (latest_state === null) {
      throw new Error("文本保护页面状态未准备就绪。");
    }

    await act(async () => {
      await latest_state!.update_mode("smart");
    });

    expect(push_toast_mock).not.toHaveBeenCalledWith("success", expect.anything());
  });

  it("在模式切换进行中忽略后续重复点击", async () => {
    const update_deferred: { resolve: () => void } = {
      resolve: () => {},
    };
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/workbench/snapshot") {
        return {
          sectionRevisions: {
            quality: 1,
          },
        };
      }
      return await new Promise((resolve) => {
        update_deferred.resolve = () => {
          resolve({
            accepted: true,
            changes: [
              {
                source: "quality_rule_update",
                projectPath: "E:/demo/sample.lg",
                projectRevision: 2,
                updatedSections: ["quality"],
                sectionRevisions: {
                  quality: 2,
                },
                sections: {
                  quality: {
                    payloadMode: "canonical-delta",
                    data: {
                      ...run_state.quality,
                      text_preserve: {
                        ...run_state.quality.text_preserve,
                        mode: "smart",
                        revision: 2,
                      },
                    },
                  },
                },
              },
            ],
          });
        };
      });
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

    expect(
      api_fetch_mock.mock.calls.filter((call) => call[0] === "/api/quality/rules/update"),
    ).toHaveLength(1);
    expect(latest_state?.mode_updating).toBe(true);

    await act(async () => {
      update_deferred.resolve();
      await Promise.resolve();
      await first_update!;
      await second_update!;
    });

    expect(latest_state?.mode).toBe("smart");
    expect(latest_state?.mode_updating).toBe(false);
  });

  it("首次进入页面时直接读取预热后的统计结果", async () => {
    await mount_probe();

    expect(latest_state?.hit_ready).toBe(true);
    expect(latest_state?.hit_badge_by_entry_id["foo::0"]?.hits).toBe(1);
  });

  it("统计未 ready 时不会保留旧 hit 排序", async () => {
    await mount_probe();

    await act(async () => {
      latest_state?.apply_table_sort_state({
        column_id: "hit",
        direction: "descending",
      });
    });
    expect(latest_state?.sort_state?.column_id).toBe("hit");

    current_hit_cache = create_hit_cache({
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

    expect(latest_state?.hit_ready).toBe(false);
    expect(latest_state?.sort_state).toBeNull();
    expect(latest_state?.hit_badge_by_entry_id["foo::0"]?.hits).toBe(1);
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

  it("新增文本保护规则保存时拒绝 \\UXXXXXXXX 转义", async () => {
    await mount_probe();

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "\\U0001F600",
        info: "旧写法",
      });
    });
    await act(async () => {
      await latest_state?.save_dialog_entry();
    });

    expect(latest_state?.dialog_state.validation_message).toContain(
      "quality_editor.feedback.regex_invalid",
    );
    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("quality_editor.feedback.regex_invalid"),
    );
    expect(api_fetch_mock).not.toHaveBeenCalled();
  });

  it("新增文本保护规则保存时若 SSE 先于 HTTP 返回，统一 commit 重放后仍保留新条目", async () => {
    await mount_probe();
    const write_result = create_quality_write_result({
      quality: create_text_preserve_quality(
        [
          {
            entry_id: "foo::0",
            src: "foo",
            info: "bar",
          },
          {
            entry_id: "qr:baz",
            src: "baz",
            info: "keep",
          },
        ],
        2,
      ),
    });
    let resolve_save: (payload: typeof write_result) => void = () => {};
    api_fetch_mock.mockReturnValueOnce(
      new Promise<typeof write_result>((resolve) => {
        resolve_save = resolve;
      }),
    );

    await act(async () => {
      latest_state?.open_create_dialog();
    });
    await act(async () => {
      latest_state?.update_dialog_draft({
        src: "baz",
        info: "keep",
      });
    });

    let save_promise: Promise<void> = Promise.resolve();
    await act(async () => {
      save_promise = latest_state?.save_dialog_entry() ?? Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      apply_quality_write_result(write_result);
    });
    await rerender_probe();

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["foo", "baz"]);

    await act(async () => {
      resolve_save(write_result);
      await save_promise;
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["foo", "baz"]);
  });

  it("导入重复文本保护规则时先确认，跳过只保存非重复规则", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "foo",
            info: "new",
          },
          {
            src: "baz",
            info: "keep",
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_write_result({
          quality: create_text_preserve_quality(
            [
              {
                entry_id: "foo::0",
                src: "foo",
                info: "bar",
              },
              {
                entry_id: "baz::1",
                src: "baz",
                info: "keep",
              },
            ],
            2,
          ),
        }),
      );

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/text-preserve.json");
    });

    expect(latest_state?.import_confirm_state.open).toBe(true);
    expect(latest_state?.import_confirm_state.duplicate_count).toBe(1);
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest_state?.import_duplicate_skip();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/update", {
      rule_type: "text_preserve",
      expected_section_revisions: { quality: 1 },
      entries: [
        {
          entry_id: "foo::0",
          src: "foo",
          info: "bar",
        },
        {
          entry_id: "baz::1",
          src: "baz",
          info: "keep",
        },
      ],
    });
  });

  it("导入保存失败时恢复原来的冻结结果成员", async () => {
    vi.useFakeTimers();
    await mount_probe();

    await act(async () => {
      latest_state?.update_filter_keyword("foo");
    });
    expect(latest_state?.filter_state.keyword).toBe("foo");
    await flush_filter_debounce();
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["foo"]);

    run_state = {
      ...run_state,
      quality: {
        ...run_state.quality,
        text_preserve: {
          ...run_state.quality.text_preserve,
          entries: [
            {
              src: "foo",
              info: "bar",
            },
            {
              src: "foobar",
              info: "hidden",
            },
          ],
          revision: 2,
        },
      },
      revisions: {
        ...run_state.revisions,
        sections: {
          ...run_state.revisions.sections,
          quality: 2,
        },
      },
    };
    await rerender_probe();
    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["foo"]);

    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "baz",
            info: "keep",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("保存失败"));

    await act(async () => {
      await latest_state?.import_entries_from_path("E:/demo/text-preserve.json");
    });

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["foo"]);
  });

  it("预设重复文本保护规则选择覆盖时会保存新备注", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "foo",
            info: "",
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_write_result({
          quality: create_text_preserve_quality(
            [
              {
                entry_id: "foo::0",
                src: "foo",
                info: "",
              },
            ],
            2,
          ),
        }),
      );

    await act(async () => {
      await latest_state?.apply_preset("builtin:demo.json");
    });
    await act(async () => {
      await latest_state?.import_duplicate_overwrite();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/update", {
      rule_type: "text_preserve",
      expected_section_revisions: { quality: 1 },
      entries: [
        {
          entry_id: "foo::0",
          src: "foo",
          info: "",
        },
      ],
    });
  });

  it("Agent 运行中锁定文本保护 write，但保留筛选和已有项查看可用", async () => {
    runtime_snapshot = { revision: 1, owner: "agent" };
    await mount_probe();

    expect(latest_state?.readonly).toBe(true);
    expect(latest_state?.drag_disabled).toBe(true);

    act(() => {
      latest_state?.open_create_dialog();
      latest_state?.update_filter_keyword("foo");
    });

    expect(latest_state?.dialog_state.open).toBe(false);
    expect(latest_state?.filter_state.keyword).toBe("foo");

    await act(async () => {
      latest_state?.open_edit_dialog("foo::0");
    });
    expect(latest_state?.dialog_state.open).toBe(true);
    expect(latest_state?.dialog_state.mode).toBe("edit");

    await act(async () => {
      latest_state?.update_dialog_draft({ info: "只读查看" });
      await latest_state?.save_dialog_entry();
    });

    expect(latest_state?.dialog_state.open).toBe(true);
    expect(api_fetch_mock).not.toHaveBeenCalled();
  });

  it("重新进入文本保护页时保留搜索排序和选中位置", async () => {
    run_state = {
      ...run_state,
      quality: {
        ...run_state.quality,
        text_preserve: {
          ...run_state.quality.text_preserve,
          entries: [
            {
              src: "foo",
              info: "bar",
            },
            {
              src: "baz",
              info: "keep",
            },
          ],
        },
      },
    };
    await mount_probe();

    await act(async () => {
      latest_state?.update_filter_keyword("foo");
      latest_state?.apply_table_sort_state({
        column_id: "info",
        direction: "descending",
      });
      latest_state?.apply_table_selection({
        selected_row_ids: ["foo::0"],
        active_row_id: "foo::0",
        anchor_row_id: "foo::0",
      });
    });

    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;

    await mount_probe();

    expect(latest_state?.filter_state.keyword).toBe("foo");
    expect(latest_state?.sort_state).toEqual({
      column_id: "info",
      direction: "descending",
    });
    expect(latest_state?.selected_entry_ids).toEqual(["foo::0"]);
    expect(latest_state?.active_entry_id).toBe("foo::0");
    expect(latest_state?.restore_scroll_entry_id).toBe("foo::0");
  });
});
