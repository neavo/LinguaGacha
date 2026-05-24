import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectItemPublicRecord } from "@base/item";

import { INPUT_QUERY_DEBOUNCE_MS } from "@/hooks/use-debounce";
import { useNameFieldExtractionPageState } from "@/pages/name-field-extraction-page/use-name-field-extraction-page-state";
import { createProjectItemIndex } from "@/project/store/project-item-index";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
  };
});

let runtime_state = {
  project: {
    path: "E:/demo/sample.lg",
    loaded: true,
  },
  files: {},
  items: createProjectItemIndex({}),
  quality: {
    glossary: {
      entries: [
        {
          entry_id: "Alice::0",
          src: "Alice",
          dst: "爱丽丝",
          info: "",
          case_sensitive: false,
        },
      ],
      enabled: true,
      mode: "custom",
      revision: 4,
    },
    pre_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
    post_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
    text_preserve: { entries: [], enabled: false, mode: "off", revision: 0 },
  },
  revisions: {
    projectRevision: 4,
    sections: {
      quality: 4,
    },
  },
};

// create_test_item 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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

// create_runtime_items 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_runtime_items(): ReturnType<typeof createProjectItemIndex> {
  return createProjectItemIndex({
    "1": create_test_item({
      item_id: 1,
      src: "Alice says hello",
      name_src: "Alice",
    }),
    "2": create_test_item({
      item_id: 2,
      src: "Bob says hello",
      name_src: "Bob",
    }),
  });
}

const project_store_listeners = new Set<() => void>();

// apply_quality_mutation_result 收口测试中的共享步骤，保证断言只关注当前行为。
function apply_quality_mutation_result(result: {
  changes?: Array<{
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
    for (const operation of change.operations ?? []) {
      const next_quality = operation.sections?.quality?.data;
      if (next_quality !== undefined) {
        runtime_state = {
          ...runtime_state,
          quality: next_quality,
          revisions: {
            projectRevision:
              change.sectionRevisions?.quality ?? runtime_state.revisions.projectRevision,
            sections: {
              ...runtime_state.revisions.sections,
              quality: change.sectionRevisions?.quality ?? runtime_state.revisions.sections.quality,
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

// 测试夹具只模拟后端原始 canonical mutation payload，回灌入口由运行态 commit mock 触发。
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

// 姓名导入只改变 glossary 切片，测试显式写出后端回灌后的完整质量事实。
function create_glossary_quality(
  entries: typeof runtime_state.quality.glossary.entries,
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

const project_store = {
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState: () => runtime_state,
};

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    report_renderer_error: vi.fn(async () => undefined),
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: runtime_state.project,
      project_store,
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
      task_snapshot: {
        busy: false,
        status: "idle",
      },
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

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

// Probe 收口测试中的共享步骤，保证断言只关注当前行为。
function Probe(props: {
  on_ready: (state: ReturnType<typeof useNameFieldExtractionPageState>) => void;
}): JSX.Element | null {
  const state = useNameFieldExtractionPageState();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useNameFieldExtractionPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useNameFieldExtractionPageState> | null = null;

  beforeEach(() => {
    project_store_listeners.clear();
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    runtime_state = {
      ...runtime_state,
      items: create_runtime_items(),
      quality: {
        ...runtime_state.quality,
        glossary: {
          entries: [
            {
              entry_id: "Alice::0",
              src: "Alice",
              dst: "爱丽丝",
              info: "",
              case_sensitive: false,
            },
          ],
          enabled: true,
          mode: "custom",
          revision: 4,
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

    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    vi.useRealTimers();
  });

  // mount_probe 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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

  it("导入姓名术语遇到重复时先确认，跳过只保存非重复姓名", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce(
      create_quality_mutation_result({
        quality: create_glossary_quality(
          [
            {
              entry_id: "Alice::0",
              src: "Alice",
              dst: "爱丽丝",
              info: "",
              case_sensitive: false,
            },
            {
              entry_id: "Bob::1",
              src: "Bob",
              dst: "",
              info: "",
              case_sensitive: false,
            },
          ],
          5,
        ),
        quality_revision: 5,
      }),
    );

    await act(async () => {
      await latest_state?.extract_rows();
    });
    await act(async () => {
      await latest_state?.import_to_glossary();
    });

    expect(latest_state?.import_confirm_state.open).toBe(true);
    expect(latest_state?.import_confirm_state.duplicate_count).toBe(1);
    expect(api_fetch_mock).not.toHaveBeenCalled();

    await act(async () => {
      await latest_state?.import_duplicate_skip();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
      rule_type: "glossary",
      expected_section_revisions: { quality: 4 },
      entries: [
        {
          entry_id: "Alice::0",
          src: "Alice",
          dst: "爱丽丝",
          info: "",
          case_sensitive: false,
        },
        {
          entry_id: "Bob::1",
          src: "Bob",
          dst: "",
          info: "",
          case_sensitive: false,
        },
      ],
    });
  });

  it("筛选输入即时更新，结果行在 250ms 后刷新", async () => {
    vi.useFakeTimers();
    await mount_probe();

    await act(async () => {
      await latest_state?.extract_rows();
    });
    expect(latest_state?.filtered_rows.map((row) => row.src)).toEqual(["Alice", "Bob"]);

    await act(async () => {
      latest_state?.update_filter_keyword("Alice");
    });

    expect(latest_state?.filter_state.keyword).toBe("Alice");
    expect(latest_state?.filtered_rows.map((row) => row.src)).toEqual(["Alice", "Bob"]);

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    expect(latest_state?.filtered_rows.map((row) => row.src)).toEqual(["Alice", "Bob"]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(latest_state?.filtered_rows.map((row) => row.src)).toEqual(["Alice"]);
  });
});
