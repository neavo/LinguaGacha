import {
  normalize_batch_translation_progress,
  type BatchTranslationSnapshot,
  type BatchTranslationProgress,
} from "@domain/batch-translation";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBatchTranslationTask } from "@frontend/app/session/batch-translation/use-batch-translation-task";

const { api_fetch_mock, push_toast_mock, on_request_export_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
    on_request_export_mock: vi.fn(),
  };
});

type RuntimeFixture = {
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
  task_snapshot: BatchTranslationSnapshot;
  runtime_snapshot: { revision: number; owner: "batch_translation" | null };
  commit_project_write: ReturnType<typeof vi.fn>;
  refresh_project_state: ReturnType<typeof vi.fn>;
  refresh_batch_translation: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    report_renderer_error: vi.fn(async () => undefined),
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture.current,
    useBatchTranslationSnapshot: () => runtime_fixture.current.task_snapshot,
    useRuntimeSnapshot: () => runtime_fixture.current.runtime_snapshot,
    useSyncBatchTranslationSnapshot: () => runtime_fixture.current.sync_task_snapshot,
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

/**
 * 构造当前测试场景的标准数据。
 */
function create_runtime_fixture(
  task_snapshot: BatchTranslationSnapshot = create_task_snapshot(),
): RuntimeFixture {
  return {
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
    runtime_snapshot: {
      revision: 0,
      owner: ["requested", "running", "stopping"].includes(task_snapshot.status)
        ? "batch_translation"
        : null,
    },
    commit_project_write: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      const payload = await run();
      return {
        payload,
        write_result: {
          accepted: true,
          changes: [],
        },
      };
    }),
    refresh_project_state: vi.fn(async () => {}),
    refresh_batch_translation: vi.fn(async () => runtime_fixture.current.task_snapshot),
  };
}

function flush_microtasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
  });
}

function Probe(props: {
  on_ready: (state: ReturnType<typeof useBatchTranslationTask>) => void;
}): JSX.Element | null {
  const state = useBatchTranslationTask({ onRequestExport: on_request_export_mock });

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useBatchTranslationTask", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useBatchTranslationTask> | null = null;

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
    on_request_export_mock.mockReset();
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

  it("翻译完成后请求统一译文导出流程", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({ status: "running", progress: { total_line: 2 } }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
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
        progress: { line: 2, total_line: 2, processed_line: 2, total_output_tokens: 8 },
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.task_confirm_state).toBeNull();
    expect(on_request_export_mock).toHaveBeenCalledOnce();
    expect(push_toast_mock).toHaveBeenCalledWith("success", "batch_translation.feedback.done");
    expect(api_fetch_mock).not.toHaveBeenCalledWith("/api/translation/files/export", {});
  });

  it.each([
    { scopes: [[7]], terminal: "items" },
    { scopes: [[7]], terminal: "all" },
    { scopes: [[7], []], terminal: "all" },
    { scopes: [[]], terminal: "all" },
  ] as const)("局部重翻保留导出范围：$scopes → $terminal", async ({ scopes, terminal }) => {
    api_fetch_mock.mockImplementation(async () => ({
      batch_translation: runtime_fixture.current.task_snapshot,
    }));
    for (const item_ids of scopes) {
      runtime_fixture.current = create_runtime_fixture(
        create_task_snapshot({
          status: "running",
          scope: { kind: "items", item_ids: [...item_ids] },
          progress: { total_line: 1 },
        }),
      );
      await render_probe();
    }
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        scope: terminal === "items" ? { kind: "items", item_ids: [] } : { kind: "all" },
        progress: { line: 1, total_line: 1 },
      }),
    );
    await render_probe();
    expect(on_request_export_mock).not.toHaveBeenCalled();
    expect(push_toast_mock).toHaveBeenCalledWith("success", "batch_translation.feedback.done");
  });

  it("首屏加载已完成翻译快照时不自动弹生成译文确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        progress: { line: 2, total_line: 2, processed_line: 2, total_output_tokens: 8 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    expect(on_request_export_mock).not.toHaveBeenCalled();
    expect(push_toast_mock).not.toHaveBeenCalledWith("success", "batch_translation.feedback.done");
  });

  it("翻译停止完成时只弹一次停止提示", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({ status: "stopping", progress: { line: 1, total_line: 2 } }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({ status: "stopped", progress: { line: 1, total_line: 2 } }),
    );

    await render_probe();
    await flush_microtasks();

    expect(push_toast_mock).toHaveBeenCalledTimes(1);
    expect(push_toast_mock).toHaveBeenCalledWith("success", "batch_translation.feedback.stopped");
  });

  it("停止回包晚于终态时不会把翻译运行态写回停止中", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({ status: "stopping", progress: { line: 1, total_line: 2 } }),
    );
    const initial_fixture = runtime_fixture.current;
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/batch-translation/stop") {
        runtime_fixture.current = create_runtime_fixture(
          create_task_snapshot({ status: "stopped", progress: { line: 1, total_line: 2 } }),
        );
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
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
        status: "stopped",
      }),
    );
    expect(initial_fixture.sync_task_snapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: "stopping",
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
        revision: 3,
        status: "done",
      }),
    );
    const initial_fixture = runtime_fixture.current;
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/batch-translation/start") {
        return {
          batch_translation: create_task_snapshot({
            revision: 2,
            status: "requested",
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

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/batch-translation/start", {
      mode: "new",
      scope: { kind: "all" },
    });

    expect(initial_fixture.sync_task_snapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 2,
        status: "requested",
      }),
    );
    expect(latest_state?.translation_task_display_snapshot).toMatchObject({
      revision: 3,
      status: "done",
    });
    expect(latest_state?.translation_task_metrics).toMatchObject({
      active: false,
      stopping: false,
    });
  });

  it("手动停止回包直接进入停止终态 且已有译文时不自动弹生成确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        progress: { line: 1, total_line: 2, total_output_tokens: 6 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/batch-translation/stop") {
        runtime_fixture.current = create_runtime_fixture(
          create_task_snapshot({
            status: "stopped",
            progress: { line: 1, total_line: 2, total_output_tokens: 6 },
          }),
        );
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
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
    expect(on_request_export_mock).not.toHaveBeenCalled();
  });

  it("手动停止请求失败后任务自然完成时仍自动弹生成确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        progress: { line: 1, total_line: 2, total_output_tokens: 6 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/batch-translation/stop") {
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

    expect(push_toast_mock).toHaveBeenCalledWith("error", "batch_translation.feedback.stop_failed");
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
        progress: { line: 2, total_line: 2, processed_line: 2, total_output_tokens: 8 },
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.task_confirm_state).toBeNull();
    expect(on_request_export_mock).toHaveBeenCalledOnce();
  });

  it("重翻任务按翻译任务刷新且结束后不再重复刷新", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        scope: { kind: "items", item_ids: [1] },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: create_task_snapshot({
            status: "idle",
            progress: { line: 2, total_line: 2, processed_line: 1, error_line: 1 },
          }),
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/batch-translation/snapshot", {});

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        scope: { kind: "all" },
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
  });

  it("translation reset all 成功时应用后端变更并刷新任务快照", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        progress: {
          line: 9,
          total_line: 12,
          processed_line: 8,
          error_line: 1,
          total_tokens: 300,
          total_output_tokens: 180,
          total_input_tokens: 120,
          time: 45,
          start_time: 100,
        },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/workbench/translation/reset") {
        return {
          accepted: true,
          changes: [
            {
              source: "translation_reset_all",
              projectPath: "E:/demo/sample.lg",
              projectRevision: 12,
              updatedSections: ["items"],
              sectionRevisions: {
                items: 5,
              },
              items: {
                payloadMode: "canonical-delta",
                upsert: {},
                changedIds: [11],
              },
              sections: {},
            },
          ],
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });
    runtime_fixture.current.refresh_batch_translation.mockResolvedValueOnce(
      create_task_snapshot({
        progress: {
          line: 0,
          total_line: 1,
          processed_line: 0,
          error_line: 0,
          total_tokens: 0,
          total_output_tokens: 0,
          total_input_tokens: 0,
          time: 0,
          start_time: 0,
        },
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

    expect(runtime_fixture.current.commit_project_write).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workbench.translation_write",
      }),
    );
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/workbench/translation/reset",
      expect.objectContaining({
        mode: "all",
        project_settings: {
          source_language: "EN",
          mtool_optimizer_enable: false,
          skip_duplicate_source_text_enable: true,
        },
      }),
    );
    expect(runtime_fixture.current.refresh_batch_translation).toHaveBeenCalledTimes(1);
    expect(runtime_fixture.current.refresh_batch_translation).toHaveBeenCalledWith();
  });

  it("translation reset failed 只提交失败项重置命令", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        progress: {
          line: 5,
          total_line: 7,
          processed_line: 4,
          error_line: 1,
          total_tokens: 90,
          total_output_tokens: 50,
          total_input_tokens: 40,
          time: 12,
          start_time: 20,
        },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/workbench/translation/reset") {
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
    runtime_fixture.current.refresh_batch_translation.mockResolvedValueOnce(
      create_task_snapshot({
        progress: {
          line: 0,
          total_line: 1,
          processed_line: 0,
          error_line: 0,
          total_tokens: 90,
          total_output_tokens: 50,
          total_input_tokens: 40,
          time: 12,
          start_time: 20,
        },
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

    expect(runtime_fixture.current.commit_project_write).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workbench.translation_write",
      }),
    );
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/translation/reset", {
      mode: "failed",
    });
    expect(runtime_fixture.current.refresh_batch_translation).toHaveBeenCalledWith();
  });

  it("translation reset failed 失败时由统一写入管线回传错误", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-translation/snapshot") {
        return {
          batch_translation: runtime_fixture.current.task_snapshot,
        };
      }
      if (path === "/api/workbench/translation/reset") {
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

    expect(runtime_fixture.current.commit_project_write).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workbench.translation_write",
      }),
    );
    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "batch_translation.feedback.reset_failed_failed",
    );
  });
});

/** 使用公开快照形状构造输入，类型检查及时发现协议字段漂移。 */
function create_task_snapshot(
  overrides: Partial<Omit<BatchTranslationSnapshot, "progress">> & {
    progress?: Partial<BatchTranslationProgress>;
  } = {},
): BatchTranslationSnapshot {
  return {
    revision: 0,
    status: "idle",
    request_in_flight_count: 0,
    scope: { kind: "all" },
    ...overrides,
    progress: normalize_batch_translation_progress(overrides.progress),
  };
}
