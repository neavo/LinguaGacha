import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopRefreshScheduler } from "@frontend/app/state/desktop-refresh-scheduler";
import { useDesktopEventStream } from "@frontend/app/state/desktop-event-stream";

const { open_event_stream_mock } = vi.hoisted(() => {
  return {
    open_event_stream_mock: vi.fn(),
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    open_event_stream: open_event_stream_mock,
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type DesktopEventStreamOptions = Parameters<typeof useDesktopEventStream>[0];

function create_event_source_stub(): {
  event_source: EventSource;
  emit: (event_name: string, payload: Record<string, unknown>) => void;
  open: () => void;
  has_listener: (event_name: string) => boolean;
} {
  const listener_map = new Map<string, EventListener>();
  const event_source = {
    addEventListener: vi.fn((event_name: string, listener: EventListener) => {
      listener_map.set(event_name, listener);
    }),
    close: vi.fn(() => {
      listener_map.clear();
    }),
    onopen: null as (() => void) | null,
    onerror: null,
  } as unknown as EventSource;

  return {
    event_source,
    emit: (event_name: string, payload: Record<string, unknown>) => {
      const listener = listener_map.get(event_name);
      if (listener === undefined) {
        throw new Error(`缺少事件监听器：${event_name}`);
      }

      listener({
        data: JSON.stringify(payload),
      } as MessageEvent<string>);
    },
    /** 模拟浏览器首次连接及断线重连后的 open 通知。 */
    open: () => {
      event_source.onopen?.(new Event("open"));
    },
    has_listener: (event_name: string) => listener_map.has(event_name),
  };
}

/** 让 React 微任务推进到事件监听器完成注册，达到上限仍未收敛则立即失败。 */
async function wait_for_condition(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await Promise.resolve();
    });
  }

  throw new Error("等待事件流状态收敛失败。");
}

function EventStreamProbe(props: {
  options: Omit<DesktopEventStreamOptions, "schedulerRef">;
}): JSX.Element | null {
  const scheduler_ref = useRef<DesktopRefreshScheduler | null>(null);
  useDesktopEventStream({
    ...props.options,
    schedulerRef: scheduler_ref,
  });
  return null;
}

function render_event_stream(options: Omit<DesktopEventStreamOptions, "schedulerRef">): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(<EventStreamProbe options={options} />);
  });
}

/** 只替换目标协作者，避免每个事件用例重复搭建无关管线。 */
function create_event_stream_options(
  overrides: Partial<Omit<DesktopEventStreamOptions, "schedulerRef">> = {},
): Omit<DesktopEventStreamOptions, "schedulerRef"> {
  return {
    applySettingsSnapshot: vi.fn(),
    applyTaskSnapshot: vi.fn(),
    applyRuntimeSnapshot: vi.fn(),
    refreshSettings: vi.fn(async () => undefined),
    refreshRuntime: vi.fn(async () => undefined),
    projectEvents: {
      applyProjectChangeBatch: vi.fn(),
      shouldApplyProjectChange: vi.fn(() => true),
      handleProjectDataChangedPayload: vi.fn(async () => undefined),
    },
    recovery: {
      report_state_error: vi.fn(),
      refresh_task_after_state_error: vi.fn(async () => undefined),
      refresh_project_state_after_error: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

describe("useDesktopEventStream", () => {
  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it("项目事件管线失败时用摘要化 payload 上报 renderer 错误", async () => {
    const event_stream = create_event_source_stub();
    const report_state_error = vi.fn();
    const refresh_project_state_after_error = vi.fn(async () => undefined);
    const project_pipeline_error = new Error("project pipeline failed");
    const raw_project_path = "E:/secret/private/demo.lg";
    open_event_stream_mock.mockReturnValue(event_stream.event_source);

    render_event_stream(
      create_event_stream_options({
        projectEvents: {
          applyProjectChangeBatch: vi.fn(),
          shouldApplyProjectChange: vi.fn(() => true),
          handleProjectDataChangedPayload: vi.fn(async () => {
            throw project_pipeline_error;
          }),
        },
        recovery: {
          report_state_error,
          refresh_task_after_state_error: vi.fn(async () => undefined),
          refresh_project_state_after_error,
        },
      }),
    );

    await wait_for_condition(() => event_stream.has_listener("project.data_changed"));

    await act(async () => {
      event_stream.emit("project.data_changed", {
        eventId: "event-1",
        source: "translation_commit",
        projectPath: raw_project_path,
        projectRevision: 12,
        updatedSections: ["items"],
        items: {
          payloadMode: "canonical-delta",
        },
      });
      await Promise.resolve();
    });

    await wait_for_condition(() => report_state_error.mock.calls.length > 0);
    const report_args = report_state_error.mock.calls[0]?.[1];

    expect(report_state_error).toHaveBeenCalledWith(
      project_pipeline_error,
      expect.objectContaining({
        source: "sse",
        context: { stage: "parse_project_data_changed" },
        triggeringEvent: expect.objectContaining({
          topic: "project.data_changed",
          eventId: "event-1",
          source: "translation_commit",
          projectPath: expect.objectContaining({
            basename: "demo.lg",
            pathHash: expect.any(String),
            length: raw_project_path.length,
          }),
          projectRevision: 12,
          updatedSections: ["items"],
        }),
      }),
    );
    expect(report_args?.triggeringEvent?.projectPath).not.toBe(raw_project_path);
    expect(refresh_project_state_after_error).toHaveBeenCalledWith(
      "project_data_changed_event_failed",
      { topic: "project.data_changed" },
    );
  });

  it("运行时事件立即写入共享快照", async () => {
    const event_stream = create_event_source_stub();
    const apply_runtime_snapshot = vi.fn();
    open_event_stream_mock.mockReturnValue(event_stream.event_source);
    render_event_stream(
      create_event_stream_options({ applyRuntimeSnapshot: apply_runtime_snapshot }),
    );

    await wait_for_condition(() => event_stream.has_listener("runtime.snapshot_changed"));
    act(() => {
      event_stream.emit("runtime.snapshot_changed", {
        runtime: { revision: 3, owner: "agent" },
      });
    });

    expect(apply_runtime_snapshot).toHaveBeenCalledWith({ revision: 3, owner: "agent" });
  });

  it("事件流重连后恢复各域权威状态且首次连接不重复刷新", async () => {
    const event_stream = create_event_source_stub();
    const refresh_settings = vi.fn(async () => undefined);
    const refresh_runtime = vi.fn(async () => undefined);
    const refresh_batch_translation = vi.fn(async () => undefined);
    const refresh_project = vi.fn(async () => undefined);
    open_event_stream_mock.mockReturnValue(event_stream.event_source);
    render_event_stream(
      create_event_stream_options({
        refreshSettings: refresh_settings,
        refreshRuntime: refresh_runtime,
        recovery: {
          report_state_error: vi.fn(),
          refresh_task_after_state_error: refresh_batch_translation,
          refresh_project_state_after_error: refresh_project,
        },
      }),
    );
    await wait_for_condition(() => event_stream.has_listener("batch_translation.snapshot_changed"));

    event_stream.open();
    await act(async () => {
      await Promise.resolve();
    });
    expect(refresh_settings).not.toHaveBeenCalled();
    expect(refresh_runtime).not.toHaveBeenCalled();
    expect(refresh_batch_translation).not.toHaveBeenCalled();
    expect(refresh_project).not.toHaveBeenCalled();

    event_stream.open();
    await wait_for_condition(() => refresh_settings.mock.calls.length === 1);

    expect(refresh_runtime).toHaveBeenCalledOnce();
    expect(refresh_batch_translation).toHaveBeenCalledOnce();
    expect(refresh_project).toHaveBeenCalledOnce();
  });
});
