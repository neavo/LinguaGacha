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
  };
  set_task_snapshot: ReturnType<typeof vi.fn>;
  task_snapshot: Record<string, unknown>;
  commit_local_project_patch: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  align_project_runtime_ack: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/runtime/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@/i18n", () => {
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
    task_type: "translation",
    status: "IDLE",
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
    analysis_candidate_count: 2,
    ...overrides,
  };
}

function create_runtime_fixture(
  task_snapshot: Record<string, unknown> = create_task_snapshot(),
): RuntimeFixture {
  const rollback = vi.fn();

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
            status: "ERROR",
            text_type: "NONE",
            retry_count: 1,
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
        task: {
          task_type: "translation",
          status: "IDLE",
          busy: false,
          request_in_flight_count: 0,
          line: 1,
          total_line: 1,
          processed_line: 0,
          error_line: 1,
          total_tokens: 0,
          total_output_tokens: 0,
          total_input_tokens: 0,
          time: 0,
          start_time: 0,
          analysis_candidate_count: 2,
        },
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
    },
    set_task_snapshot: vi.fn(),
    task_snapshot,
    commit_local_project_patch: vi.fn(() => ({
      rollback,
    })),
    refresh_project_runtime: vi.fn(async () => {}),
    align_project_runtime_ack: vi.fn(),
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
        status: "RUN",
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
        status: "DONE",
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
      kind: "export-translation",
      open: true,
      submitting: false,
    });
    expect(push_toast_mock).toHaveBeenCalledWith(
      "success",
      "workbench_page.translation_task.feedback.done",
    );
    expect(api_fetch_mock).not.toHaveBeenCalledWith("/api/tasks/export-translation", {});
  });

  it("首屏加载已完成翻译快照时不自动弹生成译文确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "DONE",
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

  it("确认生成译文时调用导出接口", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "RUN",
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
      if (path === "/api/tasks/export-translation") {
        return {};
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "DONE",
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

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/tasks/export-translation", {});
    expect(latest_state?.task_confirm_state).toBeNull();
  });

  it("translation reset all 成功时走本地 patch + apply + ack", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/project/translation/reset-preview") {
        return {
          items: [
            {
              id: 11,
              src: "hello",
              dst: "",
              name_src: "Alice",
              name_dst: null,
              extra_field: "",
              tag: "",
              row: 1,
              file_type: "TXT",
              file_path: "script/a.txt",
              text_type: "NONE",
              status: "NONE",
              retry_count: 0,
            },
          ],
        };
      }
      if (path === "/api/project/translation/reset") {
        return {
          accepted: true,
          projectRevision: 12,
          sectionRevisions: {
            items: 5,
            analysis: 7,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

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

    expect(runtime_fixture.current.commit_local_project_patch).toHaveBeenCalledTimes(1);
    expect(runtime_fixture.current.commit_local_project_patch.mock.calls[0]?.[0]).toMatchObject({
      source: "translation_reset_all",
      updatedSections: ["items", "analysis", "task"],
    });
    expect(runtime_fixture.current.align_project_runtime_ack).toHaveBeenCalledWith({
      accepted: true,
      projectRevision: 12,
      sectionRevisions: {
        items: 5,
        analysis: 7,
      },
    });
    expect(runtime_fixture.current.refresh_project_runtime).not.toHaveBeenCalled();
  });

  it("translation reset failed 失败时会回滚并刷新运行态", async () => {
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

    const rollback = runtime_fixture.current.commit_local_project_patch.mock.results[0]?.value
      .rollback as ReturnType<typeof vi.fn>;
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(runtime_fixture.current.refresh_project_runtime).toHaveBeenCalledTimes(1);
    expect(push_toast_mock).toHaveBeenCalledWith("error", "reset boom");
  });
});
