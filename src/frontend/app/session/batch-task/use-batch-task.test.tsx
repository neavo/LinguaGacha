import { create_batch_task_snapshot, type BatchTaskSnapshot } from "@domain/batch-task";
import {
  normalize_batch_translation_progress,
  normalize_batch_translation_run_progress,
  type BatchTranslationSnapshot,
  type BatchTranslationProgress,
} from "@domain/batch-translation";
import { type JSX, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBatchTranslationSnapshotStore } from "@frontend/app/state/batch-translation-snapshot-store";
import {
  normalize_batch_translation_snapshot,
  type BatchTranslationPayload,
} from "@shared/batch-translation/batch-translation";
import { useBatchTask } from "@frontend/app/session/batch-task/use-batch-task";

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
    mtool_optimizer_enable: boolean;
    skip_duplicate_source_text_enable: boolean;
  };
  task_snapshot: BatchTranslationSnapshot;
  requests?: readonly BatchTaskSnapshot[];
  runtime_snapshot: { revision: number; owner: "batch_translation" | "agent" | null };
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

const active_project = {
  batch_translation: createBatchTranslationSnapshotStore(),
  update_task: (payload: BatchTranslationPayload) => {
    active_project.batch_translation.applySnapshot(normalize_batch_translation_snapshot(payload));
  },
};

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => ({ ...runtime_fixture.current, active_project }),
    useBatchTranslationSnapshot: () => active_project.batch_translation.getSnapshot(),
    useBatchTaskSnapshot: () => task_payload().batch_tasks,
    useRuntimeSnapshot: () => runtime_fixture.current.runtime_snapshot,
    useSyncBatchTranslationSnapshot: () => active_project.batch_translation.applySnapshot,
  };
});

function task_payload() {
  const { task_snapshot, project_snapshot, requests = [] } = runtime_fixture.current;
  const { revision, status, source, request_in_flight_count, request_recovery } = task_snapshot;
  const progress = task_snapshot.run_progress ?? task_snapshot.progress;
  const translation: BatchTaskSnapshot[] =
    status === "idle"
      ? []
      : [
          {
            ...create_batch_task_snapshot("test-run", "translation", source ?? "standalone"),
            status,
            request_in_flight_count,
            request_recovery,
            progress: {
              unit: "item",
              total: progress.total_line,
              succeeded: progress.processed_line,
              failed: task_snapshot.run_progress?.failed_line ?? 0,
              start_time: progress.start_time,
              time: progress.time,
              input_tokens: progress.total_input_tokens,
              reasoning_tokens: progress.total_reasoning_tokens,
              output_tokens: progress.total_output_tokens,
              usage_complete: true,
            },
          },
        ];
  return {
    batch_tasks: {
      revision,
      project_path: project_snapshot.path,
      tasks: [...translation, ...requests],
    },
    batch_translation: task_snapshot,
  };
}

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_toast_mock,
  push_toast: push_toast_mock,
}));

vi.mock("@frontend/app/locale/locale-context", () => {
  return {
    useI18n: () => ({
      t: (key: string, params?: { count?: string }) =>
        params?.count === undefined ? key : `${key}:${params.count}`,
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
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    },
    task_snapshot,
    runtime_snapshot: {
      revision: 0,
      owner:
        task_snapshot.source === "agent"
          ? "agent"
          : ["requested", "running", "stopping"].includes(task_snapshot.status)
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

/** 等待快照查询及其 React 更新完成。 */
function flush_microtasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
  });
}

/** 通过公开 Hook 结果观察跨路由会话行为。 */
function Probe(props: {
  on_ready: (state: ReturnType<typeof useBatchTask>) => void;
}): JSX.Element | null {
  const state = useBatchTask({ onRequestExport: on_request_export_mock });

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useBatchTask", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useBatchTask> | null = null;

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
    active_project.batch_translation = createBatchTranslationSnapshotStore();
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    on_request_export_mock.mockReset();
  });

  /** 复用挂载点，模拟共享快照更新引起的重渲染。 */
  async function render_probe(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    const store = active_project.batch_translation;
    store.applySnapshot({
      ...runtime_fixture.current.task_snapshot,
      revision: store.getSnapshot().revision + 1,
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
  }

  it("Agent 通用请求期间可启动翻译，停止确认固定目标即使详情已切换", async () => {
    const request: BatchTaskSnapshot = {
      ...create_batch_task_snapshot("agent-run", "request", "agent"),
      status: "running",
    };
    runtime_fixture.current = create_runtime_fixture();
    runtime_fixture.current.runtime_snapshot.owner = "agent";
    runtime_fixture.current.requests = [request];
    api_fetch_mock.mockImplementation(async () => task_payload());
    await render_probe();
    expect(latest_state?.translation_action_blocked).toBe(false);
    await act(async () => latest_state?.request_start_or_continue_translation());
    expect(api_fetch_mock).toHaveBeenCalledWith(
      "/api/batch-translation/start",
      expect.objectContaining({ operation: "translate" }),
    );

    runtime_fixture.current = create_runtime_fixture(create_task_snapshot({ status: "running" }));
    runtime_fixture.current.requests = [request];
    await render_probe();
    expect(latest_state?.active_task_count).toBe(2);
    expect(latest_state?.translation_action_blocked).toBe(true);
    await act(async () => latest_state?.select_task("agent-run"));
    expect(latest_state?.detail_task?.run_id).toBe("agent-run");
    expect(latest_state?.task_display_snapshot?.run_id).toBe("test-run");
    await act(async () => {
      latest_state?.request_task_action_confirmation("stop-translation", "agent-run");
      latest_state?.select_task("test-run");
    });
    expect(latest_state?.detail_task?.run_id).toBe("test-run");
    await act(async () => latest_state?.confirm_task_action());
    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/batch-task/stop", {
      run_id: "agent-run",
    });
  });

  it("并行两项停止其中一项后，另一项继续独立更新进度与波形", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const request_running: BatchTaskSnapshot = {
      ...create_batch_task_snapshot("req-run", "request", "agent"),
      status: "running",
      progress: {
        unit: "request",
        total: 4,
        succeeded: 1,
        failed: 0,
        start_time: 8,
        time: 2,
        input_tokens: 10,
        reasoning_tokens: 0,
        output_tokens: 100,
        usage_complete: true,
      },
    };
    try {
      runtime_fixture.current = create_runtime_fixture(
        create_task_snapshot({
          status: "running",
          progress: { total_line: 10, processed_line: 2, total_output_tokens: 50, start_time: 8 },
        }),
      );
      runtime_fixture.current.requests = [request_running];
      await render_probe();

      await act(async () => vi.advanceTimersByTimeAsync(500));
      // 停止请求任务，翻译任务继续产出 token 与进度。
      runtime_fixture.current = create_runtime_fixture(
        create_task_snapshot({
          status: "running",
          progress: {
            total_line: 10,
            processed_line: 5,
            total_output_tokens: 250,
            start_time: 8,
          },
        }),
      );
      runtime_fixture.current.requests = [{ ...request_running, status: "stopped" }];
      await render_probe();

      await act(async () => vi.advanceTimersByTimeAsync(500));
      await act(async () => latest_state?.select_task("test-run"));
      expect(latest_state?.detail_task?.run_id).toBe("test-run");
      expect(latest_state?.detail_metrics.completion_percent).toBe(50);
      expect(latest_state?.task_waveform_history.some((sample) => sample > 0)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // 固定产品契约：终态、失败数、提示类型、文案键、持久显示与导出次数。
  it.each([
    ["done", 0, "success", "done", false, 1],
    ["done", 2, "warning", "ended", true, 1],
    ["stopped", 2, "info", "stopped", false, 0],
  ] as const)(
    "%s / %i 的独立与 Agent 终态反馈",
    async (status, failed_line, kind, message, persistent, export_count) => {
      for (const source of ["standalone", "agent"] as const) {
        push_toast_mock.mockClear();
        on_request_export_mock.mockClear();
        runtime_fixture.current = create_runtime_fixture(
          create_task_snapshot({ source, status: status === "stopped" ? "stopping" : "running" }),
        );
        await render_probe();
        const snapshot = {
          ...create_task_snapshot({ source, status, progress: { total_line: 99 } }),
          run_progress: normalize_batch_translation_run_progress({ failed_line }),
        };
        runtime_fixture.current = create_runtime_fixture(snapshot);
        await render_probe();
        runtime_fixture.current = create_runtime_fixture({
          ...snapshot,
          revision: snapshot.revision + 1,
        });
        await render_probe();
        if (source === "standalone") {
          expect(push_toast_mock).toHaveBeenCalledExactlyOnceWith(
            kind,
            `batch_translation.feedback.${message}`,
            {
              persistent,
              ...(status === "done" && failed_line > 0
                ? { description: `batch_translation.feedback.retry_exhausted:${failed_line}` }
                : {}),
            },
          );
          expect(on_request_export_mock).toHaveBeenCalledTimes(export_count);
        } else {
          expect(push_toast_mock).not.toHaveBeenCalled();
          expect(on_request_export_mock).not.toHaveBeenCalled();
        }
      }
    },
  );

  it("局部重翻完成后显示完成反馈并保留导出关闭状态", async () => {
    for (const item_ids of [[7], []]) {
      runtime_fixture.current = create_runtime_fixture(
        create_task_snapshot({
          status: "running",
          operation: "retranslate",
          pending_item_ids: [...item_ids],
          progress: { total_line: 1 },
        }),
      );
      await render_probe();
    }
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        operation: "retranslate",
        pending_item_ids: [],
        progress: { processed_line: 1, total_line: 1 },
      }),
    );
    await render_probe();
    expect(on_request_export_mock).not.toHaveBeenCalled();
    expect(push_toast_mock).toHaveBeenCalledWith("success", "batch_translation.feedback.done", {
      persistent: false,
    });
  });

  it("首屏加载已完成翻译快照时不自动弹导出翻译成果确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "done",
        progress: { total_line: 2, processed_line: 2, total_output_tokens: 8 },
      }),
    );
    await render_probe();
    await flush_microtasks();

    expect(on_request_export_mock).not.toHaveBeenCalled();
    expect(push_toast_mock).not.toHaveBeenCalledWith("success", "batch_translation.feedback.done", {
      persistent: false,
    });
  });

  it("手动停止回包直接进入停止终态 且已有译文时不自动弹导出确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        progress: { processed_line: 1, total_line: 2, total_output_tokens: 6 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-task/stop") {
        runtime_fixture.current = create_runtime_fixture(
          create_task_snapshot({
            status: "stopped",
            progress: { processed_line: 1, total_line: 2, total_output_tokens: 6 },
          }),
        );
        return task_payload();
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_task_action_confirmation("stop-translation", "test-run");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(latest_state?.task_confirm_state).toBeNull();
    expect(on_request_export_mock).not.toHaveBeenCalled();
  });

  it("手动停止请求失败后任务自然完成时仍自动弹导出确认框", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "running",
        progress: { processed_line: 1, total_line: 2, total_output_tokens: 6 },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/batch-task/stop") {
        throw new Error("stop boom");
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    await act(async () => {
      latest_state?.request_task_action_confirmation("stop-translation", "test-run");
    });
    await flush_microtasks();

    await act(async () => {
      await latest_state?.confirm_task_action();
    });
    await flush_microtasks();

    expect(push_toast_mock).toHaveBeenCalledWith(
      "batch_translation.feedback.stop_failed",
      expect.any(Error),
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
        progress: { total_line: 2, processed_line: 2, total_output_tokens: 8 },
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.task_confirm_state).toBeNull();
    expect(on_request_export_mock).toHaveBeenCalledOnce();
  });

  it("translation reset all 成功时应用后端变更并刷新任务快照", async () => {
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        progress: {
          total_line: 12,
          processed_line: 8,
          total_tokens: 300,
          total_output_tokens: 180,
          total_input_tokens: 120,
          time: 45,
          start_time: 100,
        },
      }),
    );
    api_fetch_mock.mockImplementation(async (path: string) => {
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
              items: { mode: "delta", changedIds: [11] },
              qualityStatisticsScope: "all",
              eventId: "test-12",
            },
          ],
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });
    runtime_fixture.current.refresh_batch_translation.mockResolvedValueOnce(
      create_task_snapshot({
        progress: {
          total_line: 1,
          processed_line: 0,
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
    // 全部重置只提交命令，项目语言与预过滤开关由后端从项目事实读取。
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/workbench/translation/reset", {
      mode: "all",
    });
    expect(push_toast_mock).toHaveBeenCalledWith("success", "app.feedback.operation_success");
    expect(runtime_fixture.current.refresh_batch_translation).toHaveBeenCalledTimes(1);
    expect(runtime_fixture.current.refresh_batch_translation).toHaveBeenCalledWith();
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
    source: overrides.status === undefined || overrides.status === "idle" ? null : "standalone",
    request_in_flight_count: 0,
    request_recovery: null,
    operation: "translate",
    pending_item_ids: [],
    ...overrides,
    progress: normalize_batch_translation_progress(overrides.progress),
  };
}
