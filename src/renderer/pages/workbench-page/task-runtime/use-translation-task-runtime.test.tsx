import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTranslationTaskRuntime } from "@/pages/workbench-page/task-runtime/use-translation-task-runtime";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
  };
});

type RuntimeFixture = {
  project_store: {
    getState: () => Record<string, unknown>;
  };
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  settings_snapshot: {
    source_language: string;
    mtool_optimizer_enable: boolean;
    skip_duplicate_source_text_enable: boolean;
  };
  sync_task_snapshot: ReturnType<typeof vi.fn>;
  task_snapshot: Record<string, unknown>;
  apply_project_mutation_result: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  refresh_task: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
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

function create_task_snapshot(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    runtime_revision: 0,
    task_type: "translation",
    status: "idle",
    busy: false,
    request_in_flight_count: 0,
    line: 0,
    total_line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
    candidate_count: 2,
    ...overrides,
  };
}

function create_runtime_fixture(
  task_snapshot: Record<string, unknown> = create_task_snapshot(),
): RuntimeFixture {
  return {
    project_store: {
      getState: () => ({
        project: {
          path: "E:/demo/sample.lg",
          loaded: true,
        },
        files: {
          "script/a.txt": {
            rel_path: "script/a.txt",
            file_type: "TXT",
            sort_index: 0,
          },
        },
        items: {
          "1": {
            item_id: 1,
            file_path: "script/a.txt",
            row_number: 1,
            src: "failed",
            dst: "old",
            name_src: null,
            name_dst: null,
            extra_field: "",
            tag: "",
            file_type: "TXT",
            status: "ERROR",
            text_type: "NONE",
            retry_count: 1,
            skip_internal_filter: false,
          },
        },
        quality: {
          glossary: { entries: [], enabled: false, mode: "off", revision: 0 },
          pre_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
          post_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
          text_preserve: { entries: [], enabled: false, mode: "off", revision: 0 },
        },
        prompts: {
          translation: { text: "", enabled: false, revision: 0 },
          analysis: { text: "", enabled: false, revision: 0 },
        },
        analysis: {
          extras: {},
          candidate_count: 2,
          candidate_aggregate: {},
          status_summary: {
            total_line: 1,
            processed_line: 0,
            error_line: 1,
            line: 1,
          },
        },
        proofreading: {
          revision: 0,
        },
        task: task_snapshot,
        revisions: {
          projectRevision: 9,
          sections: {
            items: 4,
            analysis: 6,
          },
        },
      }),
    },
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    settings_snapshot: {
      source_language: "EN",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    },
    sync_task_snapshot: vi.fn(),
    task_snapshot,
    apply_project_mutation_result: vi.fn(async () => {}),
    refresh_project_runtime: vi.fn(async () => {}),
    refresh_task: vi.fn(async () => runtime_fixture.current.task_snapshot),
  };
}

function flush_microtasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
  });
}

function Probe(props: {
  on_ready: (state: ReturnType<typeof useTranslationTaskRuntime>) => void;
}): JSX.Element | null {
  const state = useTranslationTaskRuntime();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useTranslationTaskRuntime", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useTranslationTaskRuntime> | null = null;

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
    runtime_fixture.current = create_runtime_fixture();
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
  });

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

  it("翻译完成后自动弹出生成译文确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        busy: true,
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

    expect(latest_state?.task_confirm_state).toBeNull();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        busy: false,
        line: 2,
        total_line: 2,
        processed_line: 2,
        total_output_tokens: 8,
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.task_confirm_state).toMatchObject({
      kind: "generate-translation",
      open: true,
      submitting: false,
    });
    expect(push_toast_mock).toHaveBeenCalledWith(
      "success",
      "workbench_page.translation_task.feedback.done",
    );
    expect(api_fetch_mock).not.toHaveBeenCalledWith("/api/tasks/generate-translation", {});
  });

  it("首屏加载已完成翻译快照时不自动弹生成译文确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        busy: false,
        line: 2,
        total_line: 2,
        processed_line: 2,
        total_output_tokens: 8,
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

    expect(latest_state?.task_confirm_state).toBeNull();
    expect(push_toast_mock).not.toHaveBeenCalledWith(
      "success",
      "workbench_page.translation_task.feedback.done",
    );
  });

  it("翻译停止完成时只弹一次停止提示", async () => {
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
      "workbench_page.translation_task.feedback.stopped",
    );
  });

  it("停止回包晚于终态时不会把翻译运行态写回停止中", async () => {
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
      latest_state?.request_task_action_confirmation("stop-translation");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();
    await render_probe();
    await flush_microtasks();

    expect(initial_fixture.sync_task_snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: "translation",
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
    expect(latest_state?.translation_task_metrics).toMatchObject({
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
      }),
    );
    const initial_fixture = runtime_fixture.current;
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/tasks/start") {
        return {
          task: create_task_snapshot({
            runtime_revision: 2,
            status: "requested",
            busy: true,
          }),
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();
    initial_fixture.sync_task_snapshot.mockClear();

    await act(async () => {
      await latest_state?.request_start_or_continue_translation();
    });
    await flush_microtasks();

    expect(initial_fixture.sync_task_snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_revision: 2,
        task_type: "translation",
        status: "requested",
        busy: true,
      }),
    );
    expect(latest_state?.translation_task_display_snapshot).toBeNull();
    expect(latest_state?.translation_task_metrics).toMatchObject({
      active: false,
      stopping: false,
    });
  });

  it("手动停止回包直接进入 idle 且已有译文时不自动弹生成确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        busy: true,
        line: 1,
        total_line: 2,
        total_output_tokens: 6,
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
            line: 1,
            total_line: 2,
            total_output_tokens: 6,
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
      latest_state?.request_task_action_confirmation("stop-translation");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(latest_state?.task_confirm_state).toBeNull();
    expect(api_fetch_mock).not.toHaveBeenCalledWith("/api/tasks/generate-translation", {});
  });

  it("手动停止请求失败后任务自然完成时仍自动弹生成确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        busy: true,
        line: 1,
        total_line: 2,
        total_output_tokens: 6,
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/tasks/stop") {
        throw new Error("stop boom");
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_task_action_confirmation("stop-translation");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "workbench_page.translation_task.feedback.stop_failed",
    );
    expect(latest_state?.task_confirm_state).toMatchObject({
      kind: "stop-translation",
      submitting: false,
    });

    await act(async () => {
      latest_state?.close_task_action_confirmation();
    });
    await flush_microtasks();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        busy: false,
        line: 2,
        total_line: 2,
        processed_line: 2,
        total_output_tokens: 8,
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.task_confirm_state).toMatchObject({
      kind: "generate-translation",
      open: true,
      submitting: false,
    });
  });

  it("分析任务停止完成时不会刷新翻译快照或弹翻译停止提示", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        task_type: "analysis",
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
        task_type: "analysis",
        status: "idle",
        busy: false,
        line: 1,
        total_line: 2,
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(api_fetch_mock).not.toHaveBeenCalledWith("/api/tasks/snapshot", {
      task_type: "translation",
    });
    expect(push_toast_mock).not.toHaveBeenCalledWith(
      "success",
      "workbench_page.translation_task.feedback.stopped",
    );
  });

  it("重翻任务按翻译任务刷新且结束后不再重复刷新", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        task_type: "translation",
        status: "running",
        busy: true,
        extras: { kind: "translation", scope: { kind: "items", item_ids: [1] } },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: create_task_snapshot({
            task_type: "translation",
            status: "idle",
            busy: false,
            line: 2,
            total_line: 2,
            processed_line: 1,
            error_line: 1,
          }),
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/tasks/snapshot", {
      task_type: "translation",
    });

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        task_type: "translation",
        status: "done",
        busy: false,
        extras: { kind: "translation", scope: { kind: "all" } },
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
  });

  it("确认生成译文时调用导出接口", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        busy: true,
        total_line: 1,
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/tasks/generate-translation") {
        return {};
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        busy: false,
        line: 1,
        total_line: 1,
        processed_line: 1,
        total_output_tokens: 4,
      }),
    );

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/tasks/generate-translation", {});
    expect(latest_state?.task_confirm_state).toBeNull();
  });

  it("translation reset all 成功时应用后端变更并刷新任务快照", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        line: 9,
        total_line: 12,
        processed_line: 8,
        error_line: 1,
        total_tokens: 300,
        total_output_tokens: 180,
        total_input_tokens: 120,
        time: 45,
        start_time: 100,
        candidate_count: 2,
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/translation/reset") {
        return {
          accepted: true,
          changes: [
            {
              source: "translation_reset_all",
              projectPath: "E:/demo/sample.lg",
              projectRevision: 12,
              updatedSections: ["items", "analysis"],
              sectionRevisions: {
                items: 5,
                analysis: 7,
              },
              items: {
                payloadMode: "canonical-delta",
                upsert: {},
                changedIds: [11],
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
    runtime_fixture.current.refresh_task.mockResolvedValueOnce(
      create_task_snapshot({
        line: 0,
        total_line: 1,
        processed_line: 0,
        error_line: 0,
        total_tokens: 0,
        total_output_tokens: 0,
        total_input_tokens: 0,
        time: 0,
        start_time: 0,
      }),
    );

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_task_action_confirmation("reset-all");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(runtime_fixture.current.apply_project_mutation_result).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted: true,
        changes: [
          expect.objectContaining({
            source: "translation_reset_all",
            updatedSections: ["items", "analysis"],
          }),
        ],
      }),
    );
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/project/translation/reset",
      expect.objectContaining({
        mode: "all",
        project_settings: {
          source_language: "EN",
          mtool_optimizer_enable: false,
          skip_duplicate_source_text_enable: true,
        },
        expected_section_revisions: {
          items: 4,
          analysis: 6,
        },
      }),
    );
    expect(runtime_fixture.current.refresh_task).toHaveBeenCalledTimes(1);
    expect(runtime_fixture.current.refresh_task).toHaveBeenCalledWith("translation");
    expect(runtime_fixture.current.refresh_project_runtime).not.toHaveBeenCalled();
  });

  it("translation reset failed 只提交失败项重置命令", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        line: 5,
        total_line: 7,
        processed_line: 4,
        error_line: 1,
        total_tokens: 90,
        total_output_tokens: 50,
        total_input_tokens: 40,
        time: 12,
        start_time: 20,
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/translation/reset") {
        return {
          accepted: true,
          changes: [
            {
              source: "translation_reset_failed",
              projectPath: "E:/demo/sample.lg",
              projectRevision: 13,
              updatedSections: ["items"],
              sectionRevisions: {
                items: 5,
              },
              items: {
                payloadMode: "canonical-delta",
                upsert: {},
                changedIds: [1],
              },
            },
          ],
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });
    runtime_fixture.current.refresh_task.mockResolvedValueOnce(
      create_task_snapshot({
        line: 0,
        total_line: 1,
        processed_line: 0,
        error_line: 0,
        total_tokens: 90,
        total_output_tokens: 50,
        total_input_tokens: 40,
        time: 12,
        start_time: 20,
      }),
    );

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_task_action_confirmation("reset-failed");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(runtime_fixture.current.apply_project_mutation_result).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            source: "translation_reset_failed",
            updatedSections: ["items"],
          }),
        ],
      }),
    );
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/project/translation/reset",
      expect.objectContaining({
        mode: "failed",
        expected_section_revisions: {
          items: 4,
        },
      }),
    );
    expect(runtime_fixture.current.refresh_task).toHaveBeenCalledWith("translation");
  });

  it("translation reset failed 失败时会刷新运行态", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/translation/reset") {
        throw new Error("reset boom");
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_task_action_confirmation("reset-failed");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(runtime_fixture.current.apply_project_mutation_result).not.toHaveBeenCalled();
    expect(runtime_fixture.current.refresh_project_runtime).toHaveBeenCalledTimes(1);
    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "workbench_page.translation_task.feedback.reset_failed_failed",
    );
  });
});
