import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopRuntimeRefreshScheduler } from "@/app/desktop/desktop-runtime-refresh-scheduler";
import type { ProjectRuntimeChangeEvent } from "@/app/desktop/desktop-project-change-types";
import {
  useDesktopRuntimeProjectEventPipeline,
  type DesktopRuntimeProjectEventPipeline,
  type ProjectChangeEventPayload,
} from "./desktop-runtime-project-event-pipeline";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const project_change_event: ProjectRuntimeChangeEvent = {
  eventId: "event-1",
  source: "task",
  projectPath: "E:/demo/demo.lg",
  projectRevision: 2,
  updatedSections: ["items"],
  operations: [],
};

// create_scheduler_stub 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_scheduler_stub(): DesktopRuntimeRefreshScheduler {
  return {
    flush: vi.fn(),
    enqueue_project_change: vi.fn(),
  } as unknown as DesktopRuntimeRefreshScheduler;
}

// ProjectPipelineProbe 收口测试中的共享步骤，保证断言只关注当前行为。
function ProjectPipelineProbe(props: {
  normalizeProjectChangeEvent: (
    payload: ProjectChangeEventPayload,
  ) => ProjectRuntimeChangeEvent | null;
  refreshProjectRuntimeAfterError: (
    reason: string,
    triggering_event: unknown,
    recovery_context?: unknown,
  ) => Promise<void>;
  onPipeline: (pipeline: DesktopRuntimeProjectEventPipeline) => void;
}): JSX.Element | null {
  const pipeline = useDesktopRuntimeProjectEventPipeline({
    projectSnapshot: {
      loaded: true,
      path: "E:/demo/demo.lg",
    },
    applyProjectChangeBatch: vi.fn(),
    shouldApplyProjectChange: () => true,
    queueProjectChangeDuringSessionWarming: () => false,
    normalizeProjectChangeEvent: props.normalizeProjectChangeEvent,
    recovery: {
      report_runtime_error: vi.fn(),
      refresh_project_runtime_after_error: props.refreshProjectRuntimeAfterError,
    },
  });

  useEffect(() => {
    props.onPipeline(pipeline);
  }, [pipeline, props]);

  return null;
}

// render_pipeline 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
async function render_pipeline(
  normalizeProjectChangeEvent: (
    payload: ProjectChangeEventPayload,
  ) => ProjectRuntimeChangeEvent | null,
  refreshProjectRuntimeAfterError: (
    reason: string,
    triggering_event: unknown,
    recovery_context?: unknown,
  ) => Promise<void> = async () => undefined,
): Promise<DesktopRuntimeProjectEventPipeline> {
  let pipeline: DesktopRuntimeProjectEventPipeline | null = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <ProjectPipelineProbe
        normalizeProjectChangeEvent={normalizeProjectChangeEvent}
        refreshProjectRuntimeAfterError={refreshProjectRuntimeAfterError}
        onPipeline={(next_pipeline) => {
          pipeline = next_pipeline;
        }}
      />,
    );
  });

  if (pipeline === null) {
    throw new Error("项目事件管线未初始化。");
  }
  return pipeline;
}

describe("useDesktopRuntimeProjectEventPipeline", () => {
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

  it("把可合并项目事件送入刷新调度器", async () => {
    const scheduler = create_scheduler_stub();
    const pipeline = await render_pipeline(() => project_change_event);

    await pipeline.handleProjectDataChangedPayload({
      payload: {
        eventId: "event-1",
        source: "task",
      },
      scheduler,
      isCancelled: () => false,
    });

    expect(scheduler.enqueue_project_change).toHaveBeenCalledWith(project_change_event);
    expect(scheduler.flush).not.toHaveBeenCalled();
  });

  it("无法规范化的项目事件通过统一恢复 runner 回到后端快照", async () => {
    const scheduler = create_scheduler_stub();
    const refresh_project_runtime_after_error = vi.fn(async () => undefined);
    const pipeline = await render_pipeline(() => null, refresh_project_runtime_after_error);

    await pipeline.handleProjectDataChangedPayload({
      payload: {
        eventId: "event-invalid",
        source: "task",
      },
      scheduler,
      isCancelled: () => false,
    });

    expect(scheduler.flush).toHaveBeenCalledTimes(1);
    expect(refresh_project_runtime_after_error).toHaveBeenCalledWith(
      "project_data_changed_unmergeable",
      expect.objectContaining({
        topic: "project.data_changed",
      }),
      expect.objectContaining({
        stage: "refresh_project_runtime_after_unmergeable_event",
      }),
    );
  });
});
