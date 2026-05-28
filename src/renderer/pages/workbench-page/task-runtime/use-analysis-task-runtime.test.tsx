import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAnalysisTaskRuntime } from "@/pages/workbench-page/task-runtime/use-analysis-task-runtime";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
  };
});

// run modal progress toast mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const run_modal_progress_toast_mock = vi.fn(
  async <T,>(args: { message: string; task: () => Promise<T> }): Promise<T> => {
    return await args.task();
  },
);

type RuntimeFixture = {
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  workbench_change_signal: {
    seq: number;
    reason: string;
  };
  sync_task_snapshot: ReturnType<typeof vi.fn>;
  task_snapshot: Record<string, unknown>;
  commit_project_mutation: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  refresh_task: ReturnType<typeof vi.fn>;
};

// runtime fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(
    create_task_snapshot({
      status: "running",
      busy: true,
    }),
  ),
};

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    report_renderer_error: vi.fn(async () => undefined),
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
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

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

// create_task_snapshot 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_task_snapshot(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    runtime_revision: 0,
    task_type: "analysis",
    status: "idle",
    busy: false,
    request_in_flight_count: 0,
    line: 0,
    total_line: 10,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
    candidate_count: 0,
    ...overrides,
  };
}

// create_runtime_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_runtime_fixture(task_snapshot: Record<string, unknown>): RuntimeFixture {
  return {
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    workbench_change_signal: {
      seq: 0,
      reason: "idle",
    },
    sync_task_snapshot: vi.fn(),
    task_snapshot,
    commit_project_mutation: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      const payload = await run();
      return {
        payload,
        mutation_result: {
          accepted: true,
          changes: [],
        },
      };
    }),
    refresh_project_runtime: vi.fn(async () => {}),
    refresh_task: vi.fn(async () => runtime_fixture.current.task_snapshot),
  };
}

// flush_microtasks 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function flush_microtasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
  });
}

// create_prepared_import 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_prepared_import(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    duplicate_count: 0,
    duplicate_signature: "",
    imported_count: 1,
    consumed_count: 1,
    quality_changed: true,
    updated_sections: ["quality", "analysis"],
    request_body: {
      entries: [{ src: "alpha", dst: "Alpha", info: "角色名", regex: false, case_sensitive: true }],
      consumed_candidate_srcs: ["alpha"],
      expected_section_revisions: {
        quality: 0,
        analysis: 4,
      },
    },
    ...overrides,
  };
}

function create_workbench_query_response(): Record<string, unknown> {
  return {
    sectionRevisions: {
      analysis: 4,
      quality: 0,
      prompts: 0,
    },
  };
}

// Probe 收口测试中的共享步骤，保证断言只关注当前行为。
function Probe(props: {
  on_ready: (state: ReturnType<typeof useAnalysisTaskRuntime>) => void;
}): JSX.Element | null {
  const state = useAnalysisTaskRuntime();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useAnalysisTaskRuntime", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useAnalysisTaskRuntime> | null = null;

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
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        busy: true,
      }),
    );
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    run_modal_progress_toast_mock.mockClear();
  });

  // render_probe 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  async function render_probe(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

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

  it("分析完成且存在候选术语时自动弹出导入确认框", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/analysis/candidates") {
        return {
          candidate_aggregate: {
            alpha: {
              src: "alpha",
              dst_votes: { Alpha: 1 },
              info_votes: { 角色名: 1 },
              case_sensitive: true,
            },
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.analysis_confirm_state).toBeNull();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "idle",
        busy: false,
        extras: { kind: "analysis", candidate_count: 2 },
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.analysis_confirm_state).toMatchObject({
      kind: "import-glossary",
      open: true,
      submitting: false,
    });
    expect(push_toast_mock).toHaveBeenCalledWith(
      "success",
      "workbench_page.analysis_task.feedback.done",
    );
  });

  it("手动导入遇到重复候选时打开重复确认框且不写入", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        busy: false,
        line: 10,
        processed_line: 10,
        candidate_count: 2,
        extras: { kind: "analysis", candidate_count: 2 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/analysis/candidates") {
        return {
          candidate_aggregate: {
            alpha: {
              src: "alpha",
              dst_votes: { Alpha: 1 },
              info_votes: { 角色名: 1 },
              case_sensitive: true,
            },
          },
        };
      }
      if (path === "/api/project/query/analysis-glossary-import") {
        return {
          prepared_import: create_prepared_import({
            duplicate_count: 1,
            duplicate_signature: "0:alpha:different-target:0",
          }),
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();
    await flush_microtasks();

    expect(latest_state?.analysis_task_metrics.candidate_count).toBe(2);

    await act(async () => {
      await latest_state?.request_import_analysis_glossary();
    });
    await flush_microtasks();

    expect(latest_state?.analysis_import_confirm_state).toMatchObject({
      open: true,
      duplicate_count: 1,
      submitting: false,
    });
    expect(runtime_fixture.current.commit_project_mutation).not.toHaveBeenCalled();
    expect(api_fetch_mock).not.toHaveBeenCalledWith(
      "/api/project/analysis/import-glossary",
      expect.anything(),
    );
  });

  it("重复候选选择跳过时只提交分析候选消费", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "idle",
        busy: false,
        candidate_count: 1,
        extras: { kind: "analysis", candidate_count: 1 },
      }),
    );
    const duplicate_preview = create_prepared_import({
      duplicate_count: 1,
      duplicate_signature: "0:alpha:different-target:0",
    });
    const skip_preview = create_prepared_import({
      duplicate_count: 1,
      duplicate_signature: "0:alpha:different-target:0",
      imported_count: 0,
      quality_changed: false,
      updated_sections: ["analysis"],
      request_body: {
        entries: [
          {
            src: "alpha",
            dst: "旧译名",
            info: "旧说明",
            regex: false,
            case_sensitive: true,
          },
        ],
        consumed_candidate_srcs: ["alpha"],
        expected_section_revisions: {
          quality: 0,
          analysis: 4,
        },
      },
    });
    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/analysis/candidates") {
        return {
          candidate_aggregate: {
            alpha: {
              src: "alpha",
              dst_votes: { Alpha: 1 },
              info_votes: { 角色名: 1 },
              case_sensitive: true,
            },
          },
        };
      }
      if (path === "/api/project/query/analysis-glossary-import") {
        return {
          prepared_import: body?.["action"] === "skip" ? skip_preview : duplicate_preview,
        };
      }
      if (path === "/api/project/analysis/import-glossary") {
        return {
          accepted: true,
          changes: [
            {
              source: "analysis_import_glossary",
              projectPath: "E:/demo/sample.lg",
              projectRevision: 11,
              updatedSections: ["analysis"],
              sectionRevisions: {
                analysis: 5,
              },
              sections: {
                analysis: {
                  payloadMode: "canonical-delta",
                  data: {
                    candidate_count: 0,
                  },
                },
              },
            },
          ],
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();
    await flush_microtasks();

    await act(async () => {
      await latest_state?.request_import_analysis_glossary();
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.import_analysis_glossary_duplicate_skip();
    });
    await flush_microtasks();

    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/project/query/analysis-glossary-import",
      expect.objectContaining({
        action: "skip",
        candidate_aggregate: expect.objectContaining({
          alpha: expect.objectContaining({ src: "alpha" }),
        }),
      }),
    );
    expect(runtime_fixture.current.commit_project_mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workbench.analysis_import",
        task_type: "analysis",
      }),
    );
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/analysis/import-glossary", {
      entries: [
        {
          src: "alpha",
          dst: "旧译名",
          info: "旧说明",
          regex: false,
          case_sensitive: true,
        },
      ],
      consumed_candidate_srcs: ["alpha"],
      expected_section_revisions: {
        quality: 0,
        analysis: 4,
      },
    });
    expect(runtime_fixture.current.refresh_task).toHaveBeenCalledWith("analysis");
    expect(latest_state?.analysis_import_confirm_state.open).toBe(false);
  });

  it("分析停止完成时只弹一次停止提示", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "stopping",
        busy: true,
        line: 1,
        total_line: 2,
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "idle",
        busy: false,
        line: 1,
        total_line: 2,
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(push_toast_mock).toHaveBeenCalledTimes(1);
    expect(push_toast_mock).toHaveBeenCalledWith(
      "success",
      "workbench_page.analysis_task.feedback.stopped",
    );
  });

  it("停止回包晚于终态时不会把分析运行态写回停止中", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "stopping",
        busy: true,
        line: 1,
        total_line: 2,
      }),
    );
    const initial_fixture = runtime_fixture.current;
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/tasks/stop") {
        runtime_fixture.current = create_runtime_fixture(
          create_task_snapshot({
            status: "idle",
            busy: false,
            line: 1,
            total_line: 2,
          }),
        );
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();
    initial_fixture.sync_task_snapshot.mockClear();

    await act(async () => {
      latest_state?.request_analysis_task_action_confirmation("stop-analysis");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_analysis_task_action();
    });
    await flush_microtasks();
    await render_probe();
    await flush_microtasks();

    expect(initial_fixture.sync_task_snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: "analysis",
        status: "idle",
        busy: false,
      }),
    );
    expect(initial_fixture.sync_task_snapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: "stopping",
        busy: true,
      }),
    );
    expect(latest_state?.analysis_task_metrics).toMatchObject({
      active: false,
      stopping: false,
    });
  });

  it("启动回包旧于当前终态时不会绕过运行态 store 改回进行中", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        runtime_revision: 3,
        status: "done",
        busy: false,
        total_line: 0,
      }),
    );
    const initial_fixture = runtime_fixture.current;
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/query/workbench") {
        return create_workbench_query_response();
      }
      if (path === "/api/tasks/start") {
        return {
          task: create_task_snapshot({
            runtime_revision: 2,
            status: "requested",
            busy: true,
            total_line: 0,
          }),
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();
    initial_fixture.sync_task_snapshot.mockClear();

    await act(async () => {
      await latest_state?.request_start_or_continue_analysis();
    });
    await flush_microtasks();

    expect(initial_fixture.sync_task_snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_revision: 2,
        task_type: "analysis",
        status: "requested",
        busy: true,
      }),
    );
    expect(latest_state?.analysis_task_display_snapshot).toBeNull();
    expect(latest_state?.analysis_task_metrics).toMatchObject({
      active: false,
      stopping: false,
    });
  });

  it("手动停止回包直接进入 idle 且存在候选术语时不自动弹导入确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        busy: true,
        line: 4,
        total_line: 5,
        extras: { kind: "analysis", candidate_count: 3 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/tasks/stop") {
        runtime_fixture.current = create_runtime_fixture(
          create_task_snapshot({
            status: "idle",
            busy: false,
            line: 4,
            total_line: 5,
            extras: { kind: "analysis", candidate_count: 3 },
          }),
        );
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_analysis_task_action_confirmation("stop-analysis");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_analysis_task_action();
    });
    await flush_microtasks();

    expect(latest_state?.analysis_confirm_state).toBeNull();
  });

  it("手动停止请求失败后分析自然完成时仍自动弹导入确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        busy: true,
        line: 4,
        total_line: 5,
        extras: { kind: "analysis", candidate_count: 3 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/tasks/stop") {
        throw new Error("analysis stop boom");
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_analysis_task_action_confirmation("stop-analysis");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_analysis_task_action();
    });
    await flush_microtasks();

    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "workbench_page.analysis_task.feedback.stop_failed",
    );
    expect(latest_state?.analysis_confirm_state).toMatchObject({
      kind: "stop-analysis",
      submitting: false,
    });

    await act(async () => {
      latest_state?.close_analysis_task_action_confirmation();
    });
    await flush_microtasks();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        busy: false,
        line: 5,
        processed_line: 5,
        extras: { kind: "analysis", candidate_count: 3 },
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.analysis_confirm_state).toMatchObject({
      kind: "import-glossary",
      open: true,
      submitting: false,
    });
  });

  it("翻译任务停止完成时不会刷新分析快照或弹分析停止提示", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        task_type: "translation",
        status: "stopping",
        busy: true,
        line: 1,
        total_line: 2,
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        task_type: "translation",
        status: "idle",
        busy: false,
        line: 1,
        total_line: 2,
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(api_fetch_mock).not.toHaveBeenCalledWith("/api/tasks/snapshot", {
      task_type: "analysis",
    });
    expect(push_toast_mock).not.toHaveBeenCalledWith(
      "success",
      "workbench_page.analysis_task.feedback.stopped",
    );
  });

  it("analysis reset all 成功时应用后端变更并刷新任务快照", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/query/workbench") {
        return create_workbench_query_response();
      }
      if (path === "/api/project/analysis/reset") {
        return {
          accepted: true,
          changes: [
            {
              source: "analysis_reset_all",
              projectPath: "E:/demo/sample.lg",
              projectRevision: 11,
              updatedSections: ["analysis"],
              sectionRevisions: {
                analysis: 5,
              },
              sections: {
                analysis: {
                  payloadMode: "canonical-delta",
                  data: {},
                },
              },
            },
          ],
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    runtime_fixture.current = create_runtime_fixture(create_task_snapshot());

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_analysis_task_action_confirmation("reset-all");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_analysis_task_action();
    });
    await flush_microtasks();

    expect(runtime_fixture.current.commit_project_mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workbench.analysis_reset",
        task_type: "analysis",
      }),
    );
    expect(runtime_fixture.current.refresh_task).toHaveBeenCalledTimes(1);
    expect(runtime_fixture.current.refresh_task).toHaveBeenCalledWith("analysis");
  });

  it("analysis reset failed 失败时由统一 mutation 管线回传错误", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/query/workbench") {
        return create_workbench_query_response();
      }
      if (path === "/api/project/analysis/reset") {
        throw new Error("analysis reset boom");
      }

      throw new Error(`未预期的请求：${path}`);
    });

    runtime_fixture.current = create_runtime_fixture(create_task_snapshot());

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_analysis_task_action_confirmation("reset-failed");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_analysis_task_action();
    });
    await flush_microtasks();

    expect(runtime_fixture.current.commit_project_mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workbench.analysis_reset",
        task_type: "analysis",
      }),
    );
    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "workbench_page.analysis_task.feedback.reset_failed_failed",
    );
  });
});
