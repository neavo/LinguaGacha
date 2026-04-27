import { StrictMode, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectStoreReplaceSectionPatch,
  type ProjectStoreQualityState,
} from "@/app/project/store/project-store";
import { DesktopRuntimeProvider } from "@/app/runtime/desktop/desktop-runtime-context";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";

const { api_fetch_mock, open_event_stream_mock, open_project_bootstrap_stream_mock } = vi.hoisted(
  () => {
    return {
      api_fetch_mock: vi.fn(),
      open_event_stream_mock: vi.fn(),
      open_project_bootstrap_stream_mock: vi.fn(),
    };
  },
);

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    open_event_stream: open_event_stream_mock,
    open_project_bootstrap_stream: open_project_bootstrap_stream_mock,
  };
});

type RuntimeSnapshot = {
  workbenchSeq: number;
  workbenchReason: string;
  proofreadingSeq: number;
  proofreadingReason: string;
  proofreadingMode: "full" | "delta" | "noop";
  proofreadingUpdatedSections: string[];
  proofreadingItemIds: Array<number | string>;
  fileKeys: string[];
  itemKeys: string[];
  taskStatus: string;
  taskLine: number;
  taskProcessedLine: number;
  taskOutputTokens: number;
  taskRequestInFlightCount: number;
  sourceLanguage: string;
};

type RuntimeHandle = {
  project_store: {
    getState: () => {
      quality: {
        glossary: Record<string, unknown>;
      };
      analysis: Record<string, unknown>;
    };
  };
  commit_local_project_patch: (input: {
    source: string;
    updatedSections: string[];
    patch: unknown[];
  }) => {
    rollback: () => void;
  };
};

type RuntimeHandleRef = RuntimeHandle | null;

function RuntimeProbe(props: {
  onSnapshot: (snapshot: RuntimeSnapshot) => void;
}): JSX.Element | null {
  const runtime = useDesktopRuntime();

  useEffect(() => {
    props.onSnapshot({
      workbenchSeq: runtime.workbench_change_signal.seq,
      workbenchReason: runtime.workbench_change_signal.reason,
      proofreadingSeq: runtime.proofreading_change_signal.seq,
      proofreadingReason: runtime.proofreading_change_signal.reason,
      proofreadingMode: runtime.proofreading_change_signal.mode,
      proofreadingUpdatedSections: runtime.proofreading_change_signal.updated_sections,
      proofreadingItemIds: runtime.proofreading_change_signal.item_ids,
      fileKeys: Object.keys(runtime.project_store.getState().files),
      itemKeys: Object.keys(runtime.project_store.getState().items),
      taskStatus: runtime.task_snapshot.status,
      taskLine: runtime.task_snapshot.line,
      taskProcessedLine: runtime.task_snapshot.processed_line,
      taskOutputTokens: runtime.task_snapshot.total_output_tokens,
      taskRequestInFlightCount: runtime.task_snapshot.request_in_flight_count,
      sourceLanguage: runtime.settings_snapshot.source_language,
    });
  }, [
    props,
    runtime.proofreading_change_signal.reason,
    runtime.proofreading_change_signal.mode,
    runtime.proofreading_change_signal.seq,
    runtime.settings_snapshot.source_language,
    runtime.task_snapshot.line,
    runtime.task_snapshot.processed_line,
    runtime.task_snapshot.request_in_flight_count,
    runtime.task_snapshot.status,
    runtime.task_snapshot.total_output_tokens,
    runtime.project_store,
    runtime.workbench_change_signal.reason,
    runtime.workbench_change_signal.seq,
  ]);

  return null;
}

function RuntimeHandleProbe(props: {
  onRuntime: (runtime: RuntimeHandleRef) => void;
}): JSX.Element | null {
  const runtime = useDesktopRuntime();

  useEffect(() => {
    props.onRuntime(runtime as unknown as RuntimeHandle);
  }, [props, runtime]);

  return null;
}

async function wait_for_condition(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await Promise.resolve();
    });
  }

  throw new Error("等待运行时状态收敛失败。");
}

function create_event_source_stub(): {
  event_source: EventSource;
  emit: (event_name: string, payload: Record<string, unknown>) => void;
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
  };
}

describe("DesktopRuntimeProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
    api_fetch_mock.mockReset();
    open_event_stream_mock.mockReset();
    open_project_bootstrap_stream_mock.mockReset();
    vi.useRealTimers();
  });

  it("完成 bootstrap 后补发工作台与校对页刷新信号", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "translation",
            status: "IDLE",
            busy: false,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);

    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "stage_payload",
          stage: "files",
          payload: {
            fields: ["rel_path", "file_type"],
            rows: [["chapter01.txt", "TXT"]],
          },
        };
        yield {
          type: "stage_payload",
          stage: "items",
          payload: {
            fields: ["item_id", "file_path", "status"],
            rows: [[1, "chapter01.txt", "DONE"]],
          },
        };
        yield {
          type: "completed",
          projectRevision: 4,
          sectionRevisions: {
            files: 2,
            items: 3,
          },
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.workbenchSeq === 1 && latest_snapshot.proofreadingSeq === 1;
    });

    const latest_snapshot = snapshots.at(-1);

    expect(open_project_bootstrap_stream_mock).toHaveBeenCalledWith();
    expect(latest_snapshot).toMatchObject({
      workbenchSeq: 1,
      workbenchReason: "project_bootstrap",
      proofreadingSeq: 1,
      proofreadingReason: "project_bootstrap",
      proofreadingMode: "full",
      proofreadingUpdatedSections: ["project", "items", "quality"],
      proofreadingItemIds: [],
      fileKeys: ["chapter01.txt"],
      itemKeys: ["1"],
    });
  });

  it("source_language 设置变更会更新设置快照且不额外触发项目缓存刷新信号", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
            source_language: "JA",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "translation",
            status: "IDLE",
            busy: false,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "completed",
          projectRevision: 1,
          sectionRevisions: {},
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.workbenchSeq === 1 && latest_snapshot?.proofreadingSeq === 1;
    });

    await act(async () => {
      event_stream.emit("settings.changed", {
        keys: ["source_language"],
        settings: {
          source_language: "EN",
        },
      });
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.sourceLanguage === "EN";
    });

    const latest_snapshot = snapshots.at(-1);

    expect(latest_snapshot).toMatchObject({
      sourceLanguage: "EN",
      workbenchSeq: 1,
      workbenchReason: "project_bootstrap",
      proofreadingSeq: 1,
      proofreadingReason: "project_bootstrap",
    });
  });

  it("StrictMode 双 effect 后任务进度合帧仍会持续刷新", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "translation",
            status: "RUN",
            busy: true,
            line: 0,
            total_line: 5,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "completed",
          projectRevision: 1,
          sectionRevisions: {},
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <StrictMode>
          <DesktopRuntimeProvider>
            <RuntimeProbe
              onSnapshot={(snapshot) => {
                snapshots.push(snapshot);
              }}
            />
          </DesktopRuntimeProvider>
        </StrictMode>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.taskStatus === "RUN";
    });
    await wait_for_condition(() => {
      return (
        event_stream.event_source.addEventListener as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.some((call) => call[0] === "task.progress_changed");
    });

    await act(async () => {
      event_stream.emit("task.progress_changed", {
        task_type: "translation",
        line: 2,
        total_line: 5,
        processed_line: 2,
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.taskLine === 2;
    });

    await act(async () => {
      event_stream.emit("task.progress_changed", {
        task_type: "translation",
        line: 4,
        total_line: 5,
        processed_line: 4,
        total_output_tokens: 12,
      });
      event_stream.emit("task.progress_changed", {
        task_type: "translation",
        request_in_flight_count: 3,
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.taskLine === 4 && latest_snapshot.taskRequestInFlightCount === 3;
    });

    expect(snapshots.at(-1)).toMatchObject({
      taskStatus: "RUN",
      taskLine: 4,
      taskProcessedLine: 4,
      taskOutputTokens: 12,
      taskRequestInFlightCount: 3,
    });
  });

  it("本地 project patch 会立即更新 store、任务快照并支持回滚", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let runtime_handle: RuntimeHandleRef = null;

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "translation",
            status: "IDLE",
            busy: false,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "stage_payload",
          stage: "quality",
          payload: {
            glossary: {
              entries: [],
              enabled: true,
              mode: "off",
              revision: 1,
            },
            pre_replacement: {
              entries: [],
              enabled: false,
              mode: "off",
              revision: 0,
            },
            post_replacement: {
              entries: [],
              enabled: false,
              mode: "off",
              revision: 0,
            },
            text_preserve: {
              entries: [],
              enabled: false,
              mode: "off",
              revision: 0,
            },
          },
        };
        yield {
          type: "stage_payload",
          stage: "task",
          payload: {
            task_type: "translation",
            status: "IDLE",
            busy: false,
          },
        };
        yield {
          type: "completed",
          projectRevision: 3,
          sectionRevisions: {
            quality: 1,
            task: 1,
          },
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
          <RuntimeHandleProbe
            onRuntime={(runtime) => {
              runtime_handle = runtime;
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => {
      return runtime_handle !== null && snapshots.at(-1)?.proofreadingSeq === 1;
    });

    let rollback_local_patch: (() => void) | null = null;
    await act(async () => {
      if (runtime_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }

      const current_quality = runtime_handle.project_store.getState()
        .quality as ProjectStoreQualityState;
      const local_commit = runtime_handle.commit_local_project_patch({
        source: "quality_rule_save_entries",
        updatedSections: ["quality", "task"],
        patch: [
          createProjectStoreReplaceSectionPatch("quality", {
            glossary: {
              ...current_quality.glossary,
              enabled: Boolean(current_quality.glossary.enabled),
              mode: String(current_quality.glossary.mode),
              entries: [
                {
                  id: "1",
                  src: "原文",
                  dst: "译文",
                },
              ],
              revision: 2,
            },
            pre_replacement: current_quality.pre_replacement,
            post_replacement: current_quality.post_replacement,
            text_preserve: current_quality.text_preserve,
          }),
          createProjectStoreReplaceSectionPatch("task", {
            task_type: "translation",
            status: "RUNNING",
            busy: true,
          }),
        ],
      });

      rollback_local_patch = () => {
        local_commit.rollback();
      };
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.proofreadingSeq === 2 && latest_snapshot.taskStatus === "RUNNING";
    });

    const stable_runtime = runtime_handle as RuntimeHandleRef;
    if (stable_runtime === null) {
      throw new Error("运行时句柄未准备好。");
    }

    expect(
      (stable_runtime as RuntimeHandle).project_store.getState().quality.glossary,
    ).toMatchObject({
      revision: 2,
      entries: [
        {
          id: "1",
          src: "原文",
          dst: "译文",
        },
      ],
    });
    expect(snapshots.at(-1)).toMatchObject({
      workbenchSeq: 1,
      proofreadingSeq: 2,
      proofreadingReason: "quality_rule_save_entries",
      proofreadingMode: "full",
      taskStatus: "RUNNING",
    });

    await act(async () => {
      rollback_local_patch?.();
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.proofreadingSeq === 3 && latest_snapshot.taskStatus === "IDLE";
    });

    expect(
      (stable_runtime as RuntimeHandle).project_store.getState().quality.glossary,
    ).toMatchObject({
      revision: 1,
      entries: [],
    });
    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 3,
      proofreadingReason: "quality_rule_save_entries_rollback",
      proofreadingMode: "full",
      taskStatus: "IDLE",
    });
  });

  it("analysis project patch 会触发工作台刷新信号", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "analysis",
            status: "IDLE",
            busy: false,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "completed",
          projectRevision: 1,
          sectionRevisions: {},
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.workbenchSeq === 1;
    });

    await act(async () => {
      event_stream.emit("project.patch", {
        source: "analysis_task_done",
        projectRevision: 2,
        updatedSections: ["analysis", "task"],
        patch: [
          {
            op: "replace_analysis",
            analysis: {
              status_summary: {
                total_line: 2,
                processed_line: 1,
                error_line: 0,
                line: 1,
              },
            },
          },
          {
            op: "replace_task",
            task: {
              task_type: "analysis",
              status: "DONE",
              busy: false,
            },
          },
        ],
      });
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.workbenchSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      workbenchSeq: 2,
      workbenchReason: "analysis_task_done",
      taskStatus: "DONE",
    });
  });

  it("本地 analysis patch 与回滚都会触发工作台刷新信号", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let runtime_handle: RuntimeHandleRef = null;

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "analysis",
            status: "IDLE",
            busy: false,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "completed",
          projectRevision: 1,
          sectionRevisions: {},
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
          <RuntimeHandleProbe
            onRuntime={(runtime) => {
              runtime_handle = runtime;
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => {
      return runtime_handle !== null && snapshots.at(-1)?.workbenchSeq === 1;
    });

    let rollback_local_patch: (() => void) | null = null;
    await act(async () => {
      if (runtime_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }

      const local_commit = runtime_handle.commit_local_project_patch({
        source: "analysis_reset_all",
        updatedSections: ["analysis", "task"],
        patch: [
          createProjectStoreReplaceSectionPatch("analysis", {
            status_summary: {
              total_line: 2,
              processed_line: 0,
              error_line: 0,
              line: 0,
            },
          }),
          createProjectStoreReplaceSectionPatch("task", {
            task_type: "analysis",
            status: "IDLE",
            busy: false,
          }),
        ],
      });

      rollback_local_patch = () => {
        local_commit.rollback();
      };
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.workbenchSeq === 2;
    });

    const stable_runtime = runtime_handle as RuntimeHandleRef;
    if (stable_runtime === null) {
      throw new Error("运行时句柄未准备好。");
    }

    expect(stable_runtime.project_store.getState().analysis).toMatchObject({
      status_summary: {
        total_line: 2,
        processed_line: 0,
      },
    });
    expect(snapshots.at(-1)).toMatchObject({
      workbenchSeq: 2,
      workbenchReason: "analysis_reset_all",
    });

    await act(async () => {
      rollback_local_patch?.();
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.workbenchSeq === 3;
    });

    expect(stable_runtime.project_store.getState().analysis).toEqual({});
    expect(snapshots.at(-1)).toMatchObject({
      workbenchSeq: 3,
      workbenchReason: "analysis_reset_all_rollback",
    });
  });

  it("merge_items patch 会把校对页信号标成 delta 并携带 item_ids", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "translation",
            status: "IDLE",
            busy: false,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "completed",
          projectRevision: 1,
          sectionRevisions: {},
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 1;
    });

    await act(async () => {
      event_stream.emit("project.patch", {
        source: "proofreading_save_item",
        projectRevision: 2,
        updatedSections: ["items", "proofreading", "task"],
        patch: [
          {
            op: "merge_items",
            items: [
              {
                item_id: 1,
                file_path: "chapter01.txt",
                row_number: 1,
                src: "foo",
                dst: "bar",
                status: "NONE",
              },
            ],
          },
          {
            op: "replace_proofreading",
            proofreading: {
              revision: 2,
            },
          },
          {
            op: "replace_task",
            task: {
              task_type: "translation",
              status: "IDLE",
              busy: false,
            },
          },
        ],
      });
      event_stream.emit("project.patch", {
        source: "proofreading_save_item",
        projectRevision: 3,
        updatedSections: ["items", "proofreading", "task"],
        patch: [
          {
            op: "merge_items",
            items: [
              {
                item_id: 2,
                file_path: "chapter01.txt",
                row_number: 2,
                src: "baz",
                dst: "qux",
                status: "NONE",
              },
            ],
          },
          {
            op: "replace_proofreading",
            proofreading: {
              revision: 3,
            },
          },
          {
            op: "replace_task",
            task: {
              task_type: "translation",
              status: "IDLE",
              busy: false,
            },
          },
        ],
      });
      await Promise.resolve();
      vi.advanceTimersByTime(250);
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 2,
      proofreadingReason: "proofreading_save_item",
      proofreadingMode: "delta",
      proofreadingUpdatedSections: ["items", "proofreading", "task"],
      proofreadingItemIds: [1, 2],
      itemKeys: ["1", "2"],
    });
  });

  it("只改 proofreading/task 且没有 item 载荷时会发 noop 信号", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/project/snapshot") {
        return {
          project: {
            path: "E:/demo/demo.lg",
            loaded: true,
          },
        };
      }

      if (path === "/api/tasks/snapshot") {
        return {
          task: {
            task_type: "translation",
            status: "IDLE",
            busy: false,
          },
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    open_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: "completed",
          projectRevision: 1,
          sectionRevisions: {},
        };
      })();
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 1;
    });

    await act(async () => {
      event_stream.emit("project.patch", {
        source: "task_status_refresh",
        projectRevision: 2,
        updatedSections: ["proofreading", "task"],
        patch: [
          {
            op: "replace_proofreading",
            proofreading: {
              revision: 2,
            },
          },
          {
            op: "replace_task",
            task: {
              task_type: "translation",
              status: "RUNNING",
              busy: true,
            },
          },
        ],
      });
      await Promise.resolve();
      vi.advanceTimersByTime(250);
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 2,
      proofreadingReason: "task_status_refresh",
      proofreadingMode: "noop",
      proofreadingUpdatedSections: ["proofreading", "task"],
      proofreadingItemIds: [],
      taskStatus: "RUNNING",
    });
  });
});
