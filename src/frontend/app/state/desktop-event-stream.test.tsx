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
  has_listener: (event_name: string) => boolean;
} {
  const listener_map = new Map<string, EventListener>();

  return {
    event_source: {
      addEventListener: vi.fn((event_name: string, listener: EventListener) => {
        listener_map.set(event_name, listener);
      }),
      close: vi.fn(() => {
        listener_map.clear();
      }),
      onerror: null,
    } as unknown as EventSource,
    emit: (event_name: string, payload: Record<string, unknown>) => {
      const listener = listener_map.get(event_name);
      if (listener === undefined) {
        throw new Error(`缺少事件监听器：${event_name}`);
      }

      listener({
        data: JSON.stringify(payload),
      } as MessageEvent<string>);
    },
    has_listener: (event_name: string) => listener_map.has(event_name),
  };
}

// wait_for_condition 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
    open_event_stream_mock.mockResolvedValue(event_stream.event_source);

    render_event_stream({
      applySettingsSnapshot: vi.fn(),
      applyTaskSnapshot: vi.fn(),
      refreshSettings: vi.fn(async () => undefined),
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
    });

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
});
