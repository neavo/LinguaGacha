import { StrictMode, act, useEffect, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QualitySnapshot } from "@shared/quality/snapshot";
import {
  DesktopStateProvider,
  normalize_settings_snapshot,
} from "@frontend/app/state/desktop-state-context";
import type { ProjectWriteCommitter } from "@frontend/app/state/desktop-project-write";
import { DESKTOP_RUNTIME_REFRESH_INTERVAL_MS } from "@frontend/app/state/desktop-refresh-scheduler";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";

const { api_fetch_mock, open_event_stream_mock, report_renderer_error_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    open_event_stream_mock: vi.fn(),
    report_renderer_error_mock: vi.fn(async () => undefined),
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    open_event_stream: open_event_stream_mock,
    report_renderer_error: report_renderer_error_mock,
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
  proofreadingFieldPatch: unknown;
  projectPath: string;
  taskStatus: string;
  taskLine: number;
  taskProcessedLine: number;
  taskOutputTokens: number;
  taskRequestInFlightCount: number;
  sourceLanguage: string;
};

type StateHandle = {
  refresh_project_snapshot: () => Promise<{ path: string; loaded: boolean }>;
  refresh_project_state: () => Promise<void>;
  refresh_task: (task_type?: "translation" | "analysis") => Promise<unknown>;
  commit_project_write: ProjectWriteCommitter;
};

type StateHandleRef = StateHandle | null;

type ProofreadingSignalSnapshot = {
  seq: number;
  reason: string;
  mode: "full" | "delta" | "noop";
  updated_sections: string[];
  item_ids: Array<number | string>;
  field_patch: unknown;
};

function resolve_proofreading_project_change_signal(
  signal: ReturnType<typeof useDesktopState>["project_change_signal"],
): ProofreadingSignalSnapshot | null {
  if (signal.updated_sections.length === 0) {
    return null;
  }
  if (signal.updated_sections.every((section) => section === "proofreading")) {
    return {
      seq: signal.seq,
      reason: signal.reason,
      mode: "noop",
      updated_sections: [...signal.updated_sections],
      item_ids: [],
      field_patch: null,
    };
  }
  if (
    signal.updated_sections.includes("project") ||
    signal.updated_sections.includes("quality") ||
    signal.results.some((result) => result.itemDelta?.fullReplace === true)
  ) {
    return {
      seq: signal.seq,
      reason: signal.reason,
      mode: "full",
      updated_sections: [...signal.updated_sections],
      item_ids: [],
      field_patch: null,
    };
  }
  const item_ids = [
    ...new Set(
      signal.results
        .flatMap((result) => [
          ...(result.itemDelta?.upsertItemIds ?? []),
          ...(result.itemDelta?.deleteItemIds ?? []),
        ])
        .map((item_id) => Number(item_id))
        .filter((item_id) => Number.isInteger(item_id) && item_id > 0),
    ),
  ];
  if (signal.updated_sections.includes("items") && item_ids.length > 0) {
    return {
      seq: signal.seq,
      reason: signal.reason,
      mode: "delta",
      updated_sections: [...signal.updated_sections],
      item_ids,
      field_patch: signal.results[0]?.itemDelta?.fieldPatch ?? null,
    };
  }
  return {
    seq: signal.seq,
    reason: signal.reason,
    mode: "full",
    updated_sections: [...signal.updated_sections],
    item_ids: [],
    field_patch: null,
  };
}

function resolve_state_workbench_change_signal(signal: {
  seq: number;
  reason: string;
  updated_sections: string[];
}): { seq: number; reason: string } | null {
  return signal.updated_sections.some((section) =>
    ["project", "files", "items", "analysis"].includes(section),
  )
    ? {
        seq: signal.seq,
        reason: signal.reason,
      }
    : null;
}

// RuntimeProbe 收口测试中的共享步骤，保证断言只关注当前行为。
function RuntimeProbe(props: {
  onSnapshot: (snapshot: RuntimeSnapshot) => void;
}): JSX.Element | null {
  const state = useDesktopState();
  const workbench_signal = useMemo(
    () => resolve_state_workbench_change_signal(state.project_change_signal),
    [state.project_change_signal],
  );
  const proofreading_signal = useMemo(
    () => resolve_proofreading_project_change_signal(state.project_change_signal),
    [state.project_change_signal],
  );
  const last_workbench_signal_ref = useRef(workbench_signal);
  const last_proofreading_signal_ref = useRef(proofreading_signal);
  if (workbench_signal !== null) {
    last_workbench_signal_ref.current = workbench_signal;
  }
  if (proofreading_signal !== null) {
    last_proofreading_signal_ref.current = proofreading_signal;
  }

  useEffect(() => {
    const current_workbench_signal = last_workbench_signal_ref.current;
    const current_proofreading_signal = last_proofreading_signal_ref.current;
    props.onSnapshot({
      workbenchSeq: current_workbench_signal?.seq ?? 0,
      workbenchReason: current_workbench_signal?.reason ?? "",
      proofreadingSeq: current_proofreading_signal?.seq ?? 0,
      proofreadingReason: current_proofreading_signal?.reason ?? "",
      proofreadingMode: current_proofreading_signal?.mode ?? "full",
      proofreadingUpdatedSections: current_proofreading_signal?.updated_sections ?? [],
      proofreadingItemIds: current_proofreading_signal?.item_ids ?? [],
      proofreadingFieldPatch: current_proofreading_signal?.field_patch ?? null,
      projectPath: state.project_snapshot.path,
      taskStatus: state.task_snapshot.status,
      taskLine: state.task_snapshot.progress.line,
      taskProcessedLine: state.task_snapshot.progress.processed_line,
      taskOutputTokens: state.task_snapshot.progress.total_output_tokens,
      taskRequestInFlightCount: state.task_snapshot.request_in_flight_count,
      sourceLanguage: state.settings_snapshot.source_language,
    });
  }, [
    props,
    proofreading_signal,
    state.settings_snapshot.source_language,
    state.task_snapshot.progress.line,
    state.task_snapshot.progress.processed_line,
    state.task_snapshot.request_in_flight_count,
    state.task_snapshot.status,
    state.task_snapshot.progress.total_output_tokens,
    state.project_snapshot.path,
    workbench_signal,
  ]);

  return null;
}

// StateHandleProbe 收口测试中的共享步骤，保证断言只关注当前行为。
function StateHandleProbe(props: {
  onState: (runtime: StateHandleRef) => void;
}): JSX.Element | null {
  const state = useDesktopState();

  useEffect(() => {
    props.onState(state as unknown as StateHandle);
  }, [props, state]);

  return null;
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

  throw new Error("等待运行时状态收敛失败。");
}

// flush_state_refresh_window 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
async function flush_state_refresh_window(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);
    await Promise.resolve();
  });
}

// create_event_source_stub 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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

// has_event_stream_listener 收口测试中的共享步骤，保证断言只关注当前行为。
function has_event_stream_listener(event_source: EventSource, event_name: string): boolean {
  const add_event_listener = event_source.addEventListener as unknown as ReturnType<typeof vi.fn>;
  return add_event_listener.mock.calls.some((call) => call[0] === event_name);
}

// create_project_item 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_project_item(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

// create_default_project_sections 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_default_project_sections(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    project: {
      path: "E:/demo/demo.lg",
      loaded: true,
    },
    files: {
      "chapter01.txt": {
        rel_path: "chapter01.txt",
        file_type: "TXT",
      },
    },
    items: {
      "1": create_project_item({
        item_id: 1,
        file_path: "chapter01.txt",
        status: "PROCESSED",
      }),
    },
    quality: {
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
    prompts: {
      translation: {
        text: "",
        enabled: false,
        revision: 0,
      },
      analysis: {
        text: "",
        enabled: false,
        revision: 0,
      },
    },
    analysis: {
      extras: {},
      candidate_count: 0,
      candidate_aggregate: {},
      status_summary: {},
    },
    proofreading: {
      revision: 0,
    },
    ...overrides,
  };
}

// create_project_read_response 构造 manifest 响应夹具，避免每个用例重复铺设环境。
function create_project_read_response(
  path: string,
  options: {
    projectRevision?: number;
    sectionRevisions?: Record<string, number>;
    sections?: Record<string, unknown>;
  } = {},
): Record<string, unknown> | null {
  const project_revision = options.projectRevision ?? 1;
  const section_revisions = options.sectionRevisions ?? {};
  const project_section = options.sections?.project;
  const response_project_path =
    typeof project_section === "object" && project_section !== null && "path" in project_section
      ? String((project_section as { path?: unknown }).path ?? "E:/demo/demo.lg")
      : "E:/demo/demo.lg";
  if (path === "/api/session/project/manifest") {
    return {
      projectPath: response_project_path,
      project: {
        path: response_project_path,
        loaded: true,
      },
      projectRevision: project_revision,
      sectionRevisions: section_revisions,
    };
  }

  return null;
}

describe("设置快照归一", () => {
  it("缺字段 settings payload 使用 base 设置领域默认值", () => {
    expect(normalize_settings_snapshot({ settings: {} })).toMatchObject({
      output_folder_open_on_finish: false,
      request_timeout: 120,
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    });
  });
});

describe("DesktopStateProvider", () => {
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
    report_renderer_error_mock.mockReset();
    vi.useRealTimers();
  });

  it("完成项目数据读取后补发工作台与校对页刷新信号", async () => {
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

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.workbenchSeq === 1 && latest_snapshot.proofreadingSeq === 1;
    });

    const latest_snapshot = snapshots.at(-1);

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/project/manifest", {});
    expect(latest_snapshot).toMatchObject({
      workbenchSeq: 1,
      workbenchReason: "project_loaded",
      proofreadingSeq: 1,
      proofreadingReason: "project_loaded",
      proofreadingMode: "full",
      proofreadingUpdatedSections: [
        "project",
        "files",
        "items",
        "quality",
        "prompts",
        "analysis",
        "proofreading",
      ],
      proofreadingItemIds: [],
    });
  });

  it("页面恢复入口会把业务上下文交给运行态统一上报", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let state_handle: StateHandleRef = null;

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
          <StateHandleProbe
            onState={(state) => {
              state_handle = state;
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => {
      return state_handle !== null && snapshots.at(-1)?.proofreadingSeq === 1;
    });

    api_fetch_mock.mockClear();
    report_renderer_error_mock.mockClear();
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/session/project/manifest") {
        throw new Error("manifest boom");
      }

      throw new Error(`未预期的恢复请求：${path}`);
    });

    await act(async () => {
      await expect(
        state_handle?.commit_project_write({
          operation: "glossary.entries_save",
          task_type: "translation",
          run: async () => {
            throw new Error("write boom");
          },
        }),
      ).rejects.toThrow("write boom");
      await Promise.resolve();
    });

    await wait_for_condition(() => report_renderer_error_mock.mock.calls.length >= 2);

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/project/manifest", {});
    expect(report_renderer_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "project-write",
        triggeringEvent: {
          operation: "glossary.entries_save",
        },
        context: expect.objectContaining({
          stage: "commit_project_write",
          operation: "glossary.entries_save",
          phase: "request",
          taskType: "translation",
        }),
      }),
    );
    expect(report_renderer_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "state-recovery",
        triggeringEvent: {
          operation: "glossary.entries_save",
        },
        context: expect.objectContaining({
          reason: "project_write_failed",
          recovery: "project_state",
          operation: "glossary.entries_save",
          phase: "request",
          taskType: "translation",
        }),
      }),
    );
  });

  it("显式刷新任务快照时会把任务类型传给 Backend", async () => {
    let state_handle: StateHandleRef = null;
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }

      if (path === "/api/session/project/snapshot") {
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
            task_type: body?.["task_type"] ?? "translation",
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <StateHandleProbe
            onState={(state) => {
              state_handle = state;
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => state_handle !== null);

    await act(async () => {
      if (state_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }
      await state_handle.refresh_task("analysis");
    });

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/tasks/snapshot", {
      task_type: "analysis",
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

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
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
      workbenchReason: "project_loaded",
      proofreadingSeq: 1,
      proofreadingReason: "project_loaded",
    });
  });

  it("StrictMode 双 effect 后完整任务快照仍会按刷新窗口持续刷新", async () => {
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

      if (path === "/api/session/project/snapshot") {
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
            status: "running",
            busy: true,
            progress: {
              line: 0,
              total_line: 5,
            },
            extras: { kind: "translation", scope: { kind: "all" } },
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <StrictMode>
          <DesktopStateProvider>
            <RuntimeProbe
              onSnapshot={(snapshot) => {
                snapshots.push(snapshot);
              }}
            />
          </DesktopStateProvider>
        </StrictMode>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.taskStatus === "running";
    });
    await wait_for_condition(() => {
      return (
        event_stream.event_source.addEventListener as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.some((call) => call[0] === "task.snapshot_changed");
    });

    await act(async () => {
      event_stream.emit("task.snapshot_changed", {
        task: {
          task_type: "translation",
          status: "running",
          busy: true,
          progress: {
            line: 2,
            total_line: 5,
            processed_line: 2,
          },
          extras: { kind: "translation", scope: { kind: "all" } },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    await wait_for_condition(() => {
      return snapshots.at(-1)?.taskLine === 2;
    });

    await act(async () => {
      event_stream.emit("task.snapshot_changed", {
        task: {
          task_type: "translation",
          status: "running",
          busy: true,
          progress: {
            line: 4,
            total_line: 5,
            processed_line: 4,
            total_output_tokens: 12,
          },
          request_in_flight_count: 3,
          extras: { kind: "translation", scope: { kind: "all" } },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.taskLine === 4 && latest_snapshot.taskRequestInFlightCount === 3;
    });

    expect(snapshots.at(-1)).toMatchObject({
      taskStatus: "running",
      taskLine: 4,
      taskProcessedLine: 4,
      taskOutputTokens: 12,
      taskRequestInFlightCount: 3,
    });
  });

  it("项目 write 结果会立即触发校对页刷新信号", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let state_handle: StateHandleRef = null;

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
          <StateHandleProbe
            onState={(state) => {
              state_handle = state;
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => {
      return state_handle !== null && snapshots.at(-1)?.proofreadingSeq === 1;
    });

    await act(async () => {
      if (state_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }

      const current_quality = create_default_project_sections().quality as QualitySnapshot;

      await state_handle.commit_project_write({
        operation: "glossary.entries_save",
        run: async () => ({
          accepted: true,
          changes: [
            {
              eventId: "quality-write-1",
              source: "quality_rule_save_entries",
              projectPath: "E:/demo/demo.lg",
              projectRevision: 2,
              updatedSections: ["quality"],
              sectionRevisions: {
                quality: 2,
              },
              sections: {
                quality: {
                  payloadMode: "canonical-delta",
                  data: {
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
                  },
                },
              },
            },
          ],
        }),
      });
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.proofreadingSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      workbenchSeq: 1,
      proofreadingSeq: 2,
      proofreadingReason: "quality_rule_save_entries",
      proofreadingMode: "full",
      taskStatus: "idle",
    });
  });

  it("analysis 项目变更会触发工作台刷新信号", async () => {
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

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.workbenchSeq === 1;
    });

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "analysis_task_done",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 2,
        updatedSections: ["analysis"],
        sectionRevisions: { analysis: 2 },
        sections: {
          analysis: {
            payloadMode: "canonical-delta",
            data: {
              status_summary: {
                total_line: 2,
                processed_line: 1,
                error_line: 0,
                line: 1,
              },
            },
          },
        },
      });
      event_stream.emit("task.snapshot_changed", {
        task: {
          task_type: "analysis",
          status: "done",
          busy: false,
          progress: {},
          extras: { kind: "analysis", candidate_count: 1 },
        },
      });
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.workbenchSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      workbenchSeq: 2,
      workbenchReason: "analysis_task_done",
      taskStatus: "done",
    });
  });

  it("项目 write 结果里的 analysis 变更会触发工作台刷新信号", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let state_handle: StateHandleRef = null;

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return {
          settings: {
            app_language: "ZH",
          },
        };
      }

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
          <StateHandleProbe
            onState={(state) => {
              state_handle = state;
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => {
      return state_handle !== null && snapshots.at(-1)?.workbenchSeq === 1;
    });

    await act(async () => {
      if (state_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }

      await state_handle.commit_project_write({
        operation: "workbench.analysis_reset",
        task_type: "analysis",
        run: async () => ({
          accepted: true,
          changes: [
            {
              eventId: "analysis-write-1",
              source: "analysis_reset_all",
              projectPath: "E:/demo/demo.lg",
              projectRevision: 2,
              updatedSections: ["analysis"],
              sectionRevisions: {
                analysis: 2,
              },
              sections: {
                analysis: {
                  payloadMode: "canonical-delta",
                  data: {
                    status_summary: {
                      total_line: 2,
                      processed_line: 0,
                      error_line: 0,
                      line: 0,
                    },
                  },
                },
              },
            },
          ],
        }),
      });
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.workbenchSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      workbenchSeq: 2,
      workbenchReason: "analysis_reset_all",
    });
  });

  it("items canonical-delta 会合帧刷新校对页 delta 信号并合并 item_ids", async () => {
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

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 1;
    });

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "proofreading_save_item",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 2,
        updatedSections: ["items", "proofreading"],
        sectionRevisions: { items: 2, proofreading: 2 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [1],
          upsert: {
            "1": create_project_item({
              item_id: 1,
              file_path: "chapter01.txt",
              row_number: 1,
              src: "foo",
              dst: "bar",
              status: "NONE",
            }),
          },
        },
        sections: {
          proofreading: {
            payloadMode: "canonical-delta",
            data: {
              revision: 2,
            },
          },
        },
      });
      event_stream.emit("project.data_changed", {
        source: "proofreading_save_item",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 3,
        updatedSections: ["items", "proofreading"],
        sectionRevisions: { items: 3, proofreading: 3 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [2],
          upsert: {
            "2": create_project_item({
              item_id: 2,
              file_path: "chapter01.txt",
              row_number: 2,
              src: "baz",
              dst: "qux",
              status: "NONE",
            }),
          },
        },
        sections: {
          proofreading: {
            payloadMode: "canonical-delta",
            data: {
              revision: 3,
            },
          },
        },
      });
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 2,
      proofreadingReason: "proofreading_save_item",
      proofreadingMode: "delta",
      proofreadingUpdatedSections: ["items", "proofreading"],
      proofreadingItemIds: [1, 2],
      proofreadingFieldPatch: null,
    });

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "proofreading_set_status",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 4,
        updatedSections: ["items", "proofreading"],
        sectionRevisions: { items: 4, proofreading: 4 },
        items: {
          payloadMode: "field-patch",
          changedIds: [1],
          fieldPatch: {
            status: "PROCESSED",
            retry_count: 0,
          },
        },
        sections: {
          proofreading: {
            payloadMode: "canonical-delta",
            data: {
              revision: 4,
            },
          },
        },
      });
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 3;
    });

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 3,
      proofreadingReason: "proofreading_set_status",
      proofreadingMode: "delta",
      proofreadingItemIds: [1],
      proofreadingFieldPatch: {
        status: "PROCESSED",
        retry_count: 0,
      },
    });

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "proofreading_delete_item",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 5,
        updatedSections: ["items", "proofreading"],
        sectionRevisions: { items: 5, proofreading: 5 },
        items: {
          payloadMode: "canonical-delta",
          deleteIds: [2],
        },
        sections: {
          proofreading: {
            payloadMode: "canonical-delta",
            data: {
              revision: 5,
            },
          },
        },
      });
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 4;
    });

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 4,
      proofreadingReason: "proofreading_delete_item",
      proofreadingMode: "delta",
      proofreadingItemIds: [2],
      proofreadingFieldPatch: null,
    });
  });

  it("items canonical-delta 的项目身份不匹配时不会发布项目信号", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/other.lg",
        projectRevision: 2,
        updatedSections: ["items"],
        sectionRevisions: { items: 2 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [9],
          upsert: {
            "9": create_project_item({
              item_id: 9,
              file_path: "other.txt",
              status: "PROCESSED",
            }),
          },
        },
      });
      await Promise.resolve();
    });
    await flush_state_refresh_window();

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 1,
    });
  });

  it("items canonical-delta 会在刷新窗口内发布合帧变更信号", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 4,
        updatedSections: ["items"],
        sectionRevisions: { items: 4 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [3],
          upsert: {
            "3": create_project_item({
              item_id: 3,
              file_path: "chapter03.txt",
              src: "foo",
              dst: "bar",
              status: "PROCESSED",
            }),
          },
        },
      });
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 5,
        updatedSections: ["items"],
        sectionRevisions: { items: 5 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [4],
          upsert: {
            "4": create_project_item({
              item_id: 4,
              file_path: "chapter04.txt",
              src: "hello",
              dst: "world",
              status: "PROCESSED",
            }),
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 2);

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingReason: "translation_commit",
      proofreadingMode: "delta",
      proofreadingItemIds: [3, 4],
    });
  });

  it("刷新窗口内项目批次只发布轻量变更信号", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }

      const project_read_response = create_project_read_response(path, {
        projectRevision: 6,
        sectionRevisions: { items: 6 },
      });
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 7,
        updatedSections: ["items"],
        sectionRevisions: { items: 7 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [3],
          upsert: {
            "3": create_project_item({
              item_id: 3,
              file_path: "chapter03.txt",
              src: "ok",
              dst: "ok",
            }),
          },
        },
      });
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 8,
        updatedSections: ["items"],
        sectionRevisions: { items: 8 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [4],
          upsert: {
            "4": {
              item_id: 4,
              file_path: "chapter04.txt",
            },
          },
        },
      });
      await Promise.resolve();
    });

    await flush_state_refresh_window();
    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 2);

    expect(report_renderer_error_mock).not.toHaveBeenCalled();
    expect(snapshots.at(-1)).toMatchObject({
      proofreadingReason: "translation_commit",
      proofreadingItemIds: [3, 4],
    });
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/session/project/manifest", {});
  });

  it("items canonical-delta 旧 revision 不会回退当前项目信号", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }

      const project_read_response = create_project_read_response(path, {
        projectRevision: 5,
        sectionRevisions: { items: 5 },
      });
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 5,
        updatedSections: ["items"],
        sectionRevisions: { items: 5 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [2],
          upsert: {
            "2": create_project_item({
              item_id: 2,
              file_path: "chapter02.txt",
              src: "fresh",
              dst: "fresh",
              status: "PROCESSED",
            }),
          },
        },
      });
      await Promise.resolve();
    });

    await flush_state_refresh_window();
    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 2);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 4,
        updatedSections: ["items"],
        sectionRevisions: { items: 4 },
        items: {
          payloadMode: "canonical-delta",
          changedIds: [3],
          upsert: {
            "3": create_project_item({
              item_id: 3,
              file_path: "chapter03.txt",
              src: "old",
              dst: "old",
              status: "PROCESSED",
            }),
          },
        },
      });
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingReason: "translation_commit",
    });
  });

  it("items section-invalidated 会直接发布全量刷新信号", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_reset",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 2,
        updatedSections: ["items"],
        items: {
          payloadMode: "section-invalidated",
        },
        sectionRevisions: { items: 2 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await flush_state_refresh_window();
    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 2);

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingReason: "translation_reset",
      proofreadingMode: "full",
    });
  });

  it("items section-invalidated 的旧项目事件不会回退当前项目信号", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      const project_read_response = create_project_read_response(path, {
        projectRevision: 5,
        sectionRevisions: { items: 5 },
      });
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_reset",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 6,
        updatedSections: ["items"],
        items: {
          payloadMode: "section-invalidated",
        },
        sectionRevisions: { items: 6 },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush_state_refresh_window();

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 2,
      proofreadingReason: "translation_reset",
      proofreadingMode: "full",
    });
  });

  it("项目切换后迟到的旧项目失效事件不会写入新项目信号", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let state_handle: StateHandleRef = null;
    let project_path = "E:/demo/old.lg";
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: project_path, loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (project_path === "E:/demo/next.lg") {
        const project_read_response = create_project_read_response(path, {
          projectRevision: 10,
          sectionRevisions: { project: 10, files: 10, items: 10, analysis: 10 },
          sections: create_default_project_sections({
            project: { path: "E:/demo/next.lg", loaded: true },
            files: {
              "next.txt": { rel_path: "next.txt", file_type: "TXT" },
            },
            items: {
              "9": create_project_item({
                item_id: 9,
                file_path: "next.txt",
                src: "next",
                status: "NONE",
              }),
            },
          }),
        });
        if (project_read_response !== null) {
          return project_read_response;
        }
      }

      const project_read_response = create_project_read_response(path, {
        projectRevision: 1,
        sectionRevisions: { project: 1, files: 1, items: 1, analysis: 1 },
        sections: create_default_project_sections({
          project: { path: "E:/demo/old.lg", loaded: true },
        }),
      });
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
          <StateHandleProbe
            onState={(state) => {
              state_handle = state;
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.projectPath === "E:/demo/old.lg");

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_reset",
        projectPath: "E:/demo/old.lg",
        projectRevision: 2,
        updatedSections: ["items"],
        items: {
          payloadMode: "section-invalidated",
        },
        sectionRevisions: { items: 2 },
      });
      await Promise.resolve();
    });

    project_path = "E:/demo/next.lg";
    await act(async () => {
      await state_handle?.refresh_project_snapshot();
      await Promise.resolve();
      await Promise.resolve();
    });
    await wait_for_condition(() => snapshots.at(-1)?.projectPath === "E:/demo/next.lg");

    expect(snapshots.at(-1)).toMatchObject({
      projectPath: "E:/demo/next.lg",
    });
  });

  it("项目 session 初始化期间的写入结果与同源 SSE 会在快照后只重放一次", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let state_handle: StateHandleRef = null;

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/session/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (path === "/api/session/project/manifest") {
        return create_project_read_response(path, {
          projectRevision: 1,
          sectionRevisions: { project: 1, files: 1, items: 1, analysis: 1 },
        });
      }
      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
          <StateHandleProbe
            onState={(state) => {
              state_handle = state;
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => state_handle !== null);
    await wait_for_condition(() =>
      has_event_stream_listener(event_stream.event_source, "project.data_changed"),
    );
    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    const session_initializing_change = {
      eventId: "session-initializing-write-1",
      source: "translation_commit",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 2,
      updatedSections: ["items"],
      sectionRevisions: { items: 2 },
      items: {
        payloadMode: "canonical-delta",
        changedIds: [2],
        upsert: {
          "2": create_project_item({
            item_id: 2,
            file_path: "chapter02.txt",
            src: "queued",
            status: "PROCESSED",
          }),
        },
      },
    };
    const session_initializing_write_payload = {
      accepted: true,
      changes: [session_initializing_change],
    };

    await act(async () => {
      await state_handle?.commit_project_write({
        operation: "workbench.file_write",
        run: async () => session_initializing_write_payload,
      });
      event_stream.emit("project.data_changed", session_initializing_change);
      await Promise.resolve();
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 2);
    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 2,
      proofreadingReason: "translation_commit",
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

      if (path === "/api/session/project/snapshot") {
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
            status: "idle",
            busy: false,
          },
        };
      }

      const project_read_response = create_project_read_response(path);
      if (project_read_response !== null) {
        return project_read_response;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DesktopStateProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopStateProvider>,
      );
    });

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 1;
    });

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "task_status_refresh",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 2,
        updatedSections: ["proofreading"],
        sectionRevisions: { proofreading: 2 },
        sections: {
          proofreading: {
            payloadMode: "canonical-delta",
            data: {
              revision: 2,
            },
          },
        },
      });
      event_stream.emit("task.snapshot_changed", {
        task: {
          task_type: "translation",
          status: "running",
          busy: true,
        },
      });
      await Promise.resolve();
    });

    await flush_state_refresh_window();

    await wait_for_condition(() => {
      return snapshots.at(-1)?.proofreadingSeq === 2;
    });

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 2,
      proofreadingReason: "task_status_refresh",
      proofreadingMode: "noop",
      proofreadingUpdatedSections: ["proofreading"],
      proofreadingItemIds: [],
      taskStatus: "running",
    });
  });
});
