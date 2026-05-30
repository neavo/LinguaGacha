import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@frontend/widgets/interactions/use-debounce";
import { useNameFieldExtractionPageState } from "@frontend/pages/name-field-extraction-page/use-name-field-extraction-page-state";
import type { NameFieldRow } from "@frontend/pages/name-field-extraction-page/types";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
  };
});

let run_state = {
  project: {
    path: "E:/demo/sample.lg",
    loaded: true,
  },
  files: {},
  extracted_rows: [] as NameFieldRow[],
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

function create_extracted_rows(): NameFieldRow[] {
  return [
    {
      id: "Alice",
      src: "Alice",
      dst: "爱丽丝",
      context: "Alice says hello",
      status: "translated",
    },
    {
      id: "Bob",
      src: "Bob",
      dst: "",
      context: "Bob says hello",
      status: "untranslated",
    },
  ];
}

const project_store_listeners = new Set<() => void>();

// apply_quality_write_result 收口测试中的共享步骤，保证断言只关注当前行为。
/**
 * 写入当前场景的状态变化。
 */
function apply_quality_write_result(result: {
  changes?: Array<{
    sectionRevisions?: {
      quality?: number;
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
    for (const operation of change.operations ?? []) {
      const next_quality = operation.sections?.quality?.data;
      if (next_quality !== undefined) {
        run_state = {
          ...run_state,
          quality: next_quality,
          revisions: {
            projectRevision:
              change.sectionRevisions?.quality ?? run_state.revisions.projectRevision,
            sections: {
              ...run_state.revisions.sections,
              quality: change.sectionRevisions?.quality ?? run_state.revisions.sections.quality,
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
/**
 * 构造当前测试场景的标准数据。
 */
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
        source: "quality_rule_save_entries",
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

// 姓名导入只改变 glossary 切片，测试显式写出后端回灌后的完整质量事实。
/**
 * 构造当前测试场景的标准数据。
 */
function create_glossary_quality(
  entries: typeof run_state.quality.glossary.entries,
  revision: number,
): typeof run_state.quality {
  return {
    ...run_state.quality,
    glossary: {
      ...run_state.quality.glossary,
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

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    report_renderer_error: vi.fn(async () => undefined),
  };
});

vi.mock("@frontend/pages/name-field-extraction-page/name-field-extraction-api-client", () => {
  return {
    read_name_field_extraction_query: vi.fn(async () => ({
      projectPath: run_state.project.path,
      sectionRevisions: { ...run_state.revisions.sections },
      view: {
        rows: run_state.extracted_rows,
        counts: {
          total: run_state.extracted_rows.length,
          translated: 1,
          untranslated: 1,
          error: 0,
        },
        invalid_regex_message: null,
      },
      glossary: run_state.quality.glossary,
    })),
    read_name_field_extraction_section_revisions: vi.fn(async () => ({
      ...run_state.revisions.sections,
    })),
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => ({
      project_snapshot: run_state.project,
      project_change_signal: {
        seq: 0,
        reason: "test",
        updated_sections: [],
        results: [],
      },
      project_store,
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
      refresh_project_state: vi.fn(async () => {}),
      task_snapshot: {
        busy: false,
        status: "idle",
      },
    }),
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
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
    run_state = {
      ...run_state,
      extracted_rows: create_extracted_rows(),
      quality: {
        ...run_state.quality,
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
  /**
   * 挂载当前测试组件并等待渲染完成。
   */
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
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("导入姓名术语遇到重复时先确认，跳过只保存非重复姓名", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce(
      create_quality_write_result({
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
