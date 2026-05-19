import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@/hooks/use-debounce";
import type { QualityStatisticsCacheSnapshot } from "@/project/quality/quality-statistics-store";
import type { ProjectItemPublicRecord } from "@base/item";
import { createProjectItemIndex } from "@/project/store/project-item-index";
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

let runtime_state = {
  project: {
    path: "E:/demo/sample.lg",
    loaded: true,
  },
  files: {},
  items: createProjectItemIndex({
    "1": create_test_item({
      item_id: 1,
      file_path: "chapter01.txt",
      src: "foo42",
      dst: "bar",
    }),
  }),
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
    status: "idle",
    busy: false,
    progress: {},
    extras: { kind: "analysis", candidate_count: 0 },
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

type TextPreserveRuleEntry = (typeof runtime_state.quality.text_preserve.entries)[number] & {
  entry_id?: string;
};

function apply_quality_mutation_result(result: {
  changes?: Array<{
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
    for (const operation of change.operations ?? []) {
      const next_quality = operation.sections?.quality?.data;
      if (next_quality !== undefined) {
        runtime_state = {
          ...runtime_state,
          quality: next_quality,
        };
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

// 文本保护规则保存只改变 text_preserve 切片，测试显式写出后端回灌后的完整质量事实。
function create_text_preserve_quality(
  entries: TextPreserveRuleEntry[],
  revision: number,
): typeof runtime_state.quality {
  return {
    ...runtime_state.quality,
    text_preserve: {
      ...runtime_state.quality.text_preserve,
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

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/page-runtime/project-pages-context", () => {
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

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: {
        loaded: true,
        path: "E:/demo/sample.lg",
      },
      project_store,
      settings_snapshot: {},
      apply_settings_snapshot: vi.fn(),
      refresh_project_runtime: vi.fn(async () => {}),
      task_snapshot,
      apply_project_mutation_result: vi.fn(async (result) => {
        apply_quality_mutation_result(result);
      }),
    }),
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      run_modal_progress_toast: run_modal_progress_toast_mock,
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
      status: "idle",
    };
    create_barrier_checkpoint_mock.mockReturnValue({
      projectPath: "E:/demo/sample.lg",
      proofreadingConsumedRevisions: {},
      workbenchConsumedRevisions: {},
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
      revisions: {
        ...runtime_state.revisions,
        sections: {
          ...runtime_state.revisions.sections,
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
    wait_for_barrier_mock.mockReset();
    create_barrier_checkpoint_mock.mockReset();
    run_modal_progress_toast_mock.mockClear();
    vi.useRealTimers();
  });

  async function mount_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await rerender_probe();
  }

  async function rerender_probe(): Promise<void> {
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

  async function flush_filter_debounce(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });
  }

  it("在校对缓存等待超时时保留已提交的模式并提示稍后刷新", async () => {
    vi.useFakeTimers();
    wait_for_barrier_mock.mockImplementation(async () => {
      return await new Promise<void>(() => {});
    });
    api_fetch_mock.mockResolvedValue({
      accepted: true,
      changes: [
        {
          source: "quality_rule_update_meta",
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
                ...runtime_state.quality,
                text_preserve: {
                  ...runtime_state.quality.text_preserve,
                  mode: "smart",
                  revision: 2,
                },
              },
            },
          },
        },
      ],
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
      changes: [
        {
          source: "quality_rule_update_meta",
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
                ...runtime_state.quality,
                text_preserve: {
                  ...runtime_state.quality.text_preserve,
                  mode: "smart",
                  revision: 2,
                },
              },
            },
          },
        },
      ],
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
        create_quality_mutation_result({
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

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
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

  it("导入非重复文本保护规则后立即用最新规则重建表格", async () => {
    await mount_probe();
    api_fetch_mock
      .mockResolvedValueOnce({
        entries: [
          {
            src: "baz",
            info: "keep",
          },
        ],
      })
      .mockResolvedValueOnce(
        create_quality_mutation_result({
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

    expect(latest_state?.filtered_entries.map((entry) => entry.entry.src)).toEqual(["foo", "baz"]);
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

    runtime_state = {
      ...runtime_state,
      quality: {
        ...runtime_state.quality,
        text_preserve: {
          ...runtime_state.quality.text_preserve,
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
        ...runtime_state.revisions,
        sections: {
          ...runtime_state.revisions.sections,
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
        create_quality_mutation_result({
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

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
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
});
