import { StrictMode, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectStoreQualityState, ProjectStoreState } from "@/project/store/project-store";
import {
  DesktopRuntimeProvider,
  normalize_project_mutation_result,
  normalize_settings_snapshot,
} from "@/app/desktop/desktop-runtime-context";
import { DESKTOP_RUNTIME_REFRESH_INTERVAL_MS } from "@/app/desktop/desktop-runtime-refresh-scheduler";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";
import { InternalInvariantError } from "@shared/error";

const { api_fetch_mock, open_event_stream_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    open_event_stream_mock: vi.fn(),
  };
});

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
    open_event_stream: open_event_stream_mock,
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
  fileKeys: string[];
  itemKeys: string[];
  taskStatus: string;
  taskLine: number;
  taskProcessedLine: number;
  taskOutputTokens: number;
  taskRequestInFlightCount: number;
  sourceLanguage: string;
};

function capture_internal_invariant(operation: () => unknown): InternalInvariantError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(InternalInvariantError);
    return error as InternalInvariantError;
  }
  throw new Error("预期抛出 InternalInvariantError。");
}

type RuntimeHandle = {
  project_store: {
    getState: () => ProjectStoreState;
  };
  refresh_project_snapshot: () => Promise<{ path: string; loaded: boolean }>;
  refresh_project_runtime: () => Promise<void>;
  refresh_task: (task_type?: "translation" | "analysis") => Promise<unknown>;
  apply_project_mutation_result: (result: {
    accepted: true;
    changes: Array<Record<string, unknown>>;
  }) => Promise<void>;
};

type RuntimeHandleRef = RuntimeHandle | null;

function create_deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve_value: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolve_value = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (resolve_value === null) {
        throw new Error("deferred 尚未初始化。");
      }
      resolve_value(value);
    },
  };
}

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
      proofreadingFieldPatch: runtime.proofreading_change_signal.field_patch,
      projectPath: runtime.project_store.getState().project.path,
      fileKeys: Object.keys(runtime.project_store.getState().files),
      itemKeys: [...runtime.project_store.getState().items.keys()],
      taskStatus: runtime.task_snapshot.status,
      taskLine: runtime.task_snapshot.progress.line,
      taskProcessedLine: runtime.task_snapshot.progress.processed_line,
      taskOutputTokens: runtime.task_snapshot.progress.total_output_tokens,
      taskRequestInFlightCount: runtime.task_snapshot.request_in_flight_count,
      sourceLanguage: runtime.settings_snapshot.source_language,
    });
  }, [
    props,
    runtime.proofreading_change_signal.reason,
    runtime.proofreading_change_signal.mode,
    runtime.proofreading_change_signal.seq,
    runtime.settings_snapshot.source_language,
    runtime.task_snapshot.progress.line,
    runtime.task_snapshot.progress.processed_line,
    runtime.task_snapshot.request_in_flight_count,
    runtime.task_snapshot.status,
    runtime.task_snapshot.progress.total_output_tokens,
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

async function flush_runtime_refresh_window(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);
    await Promise.resolve();
  });
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

function has_event_stream_listener(event_source: EventSource, event_name: string): boolean {
  const add_event_listener = event_source.addEventListener as unknown as ReturnType<typeof vi.fn>;
  return add_event_listener.mock.calls.some((call) => call[0] === event_name);
}

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
  const section_payload = create_default_project_sections(options.sections);
  const project_section = options.sections?.project;
  const response_project_path =
    typeof project_section === "object" && project_section !== null && "path" in project_section
      ? String((project_section as { path?: unknown }).path ?? "E:/demo/demo.lg")
      : "E:/demo/demo.lg";
  if (path === "/api/project/manifest") {
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

  if (path === "/api/project/read-sections") {
    return {
      projectPath: response_project_path,
      projectRevision: project_revision,
      sectionRevisions: section_revisions,
      sections: section_payload,
    };
  }

  return null;
}

describe("normalize_project_mutation_result", () => {
  it("只接受后端 canonical changes 数组并规范化为 ProjectStore 事件", () => {
    const result = normalize_project_mutation_result({
      accepted: true,
      changes: [
        {
          eventId: "mutation-quality-1",
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
                  entries: [],
                  enabled: true,
                  mode: "off",
                  revision: 2,
                },
              },
            },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      accepted: true,
      changes: [
        {
          eventId: "mutation-quality-1",
          source: "quality_rule_save_entries",
          projectPath: "E:/demo/demo.lg",
          projectRevision: 2,
          updatedSections: ["quality"],
          sectionRevisions: {
            quality: 2,
          },
        },
      ],
    });
    expect(result.changes[0]?.operations[0]?.sections?.quality?.payloadMode).toBe(
      "canonical-delta",
    );
  });

  it.each([
    ["缺少 accepted=true", { changes: [] }],
    ["changes 不是数组", { accepted: true, changes: {} }],
  ] as const)("拒绝%s的 mutation result", (_name, payload) => {
    const error = capture_internal_invariant(() => normalize_project_mutation_result(payload));

    expect(error.diagnostic_context).toMatchObject({
      reason: "invalid_project_mutation_result_payload",
    });
  });

  it("拒绝无法规范化为项目数据变更的 change 载荷", () => {
    const error = capture_internal_invariant(() =>
      normalize_project_mutation_result({
        accepted: true,
        changes: [
          {
            eventId: "mutation-invalid-1",
            source: "invalid",
            projectPath: "E:/demo/demo.lg",
            projectRevision: 2,
            updatedSections: [],
          },
        ],
      }),
    );

    expect(error.diagnostic_context).toMatchObject({
      reason: "invalid_project_mutation_change_payload",
      index: 0,
    });
  });
});

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

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/manifest", {});
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/read-sections", {
      sections: ["project", "files", "items", "quality", "prompts", "analysis", "proofreading"],
    });
    expect(latest_snapshot).toMatchObject({
      workbenchSeq: 1,
      workbenchReason: "project_read_sections",
      proofreadingSeq: 1,
      proofreadingReason: "project_read_sections",
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
      fileKeys: ["chapter01.txt"],
      itemKeys: ["1"],
    });
  });

  it("显式刷新任务快照时会把任务类型传给 Core", async () => {
    let runtime_handle: RuntimeHandleRef = null;
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
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
        <DesktopRuntimeProvider>
          <RuntimeHandleProbe
            onRuntime={(runtime) => {
              runtime_handle = runtime;
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => runtime_handle !== null);

    await act(async () => {
      if (runtime_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }
      await runtime_handle.refresh_task("analysis");
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
      workbenchReason: "project_read_sections",
      proofreadingSeq: 1,
      proofreadingReason: "project_read_sections",
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

    await flush_runtime_refresh_window();

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

    await flush_runtime_refresh_window();

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

  it("项目 mutation 结果会立即更新 store 并触发校对页刷新信号", async () => {
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

    await act(async () => {
      if (runtime_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }

      const current_quality = runtime_handle.project_store.getState()
        .quality as ProjectStoreQualityState;

      await runtime_handle.apply_project_mutation_result({
        accepted: true,
        changes: [
          {
            eventId: "quality-mutation-1",
            source: "quality_rule_save_entries",
            projectPath: "E:/demo/demo.lg",
            projectRevision: 2,
            updatedSections: ["quality"],
            sectionRevisions: {
              quality: 2,
            },
            operations: [
              {
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
          },
        ],
      });
      await Promise.resolve();
    });

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1);
      return latest_snapshot?.proofreadingSeq === 2;
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

  it("项目 mutation 结果里的 analysis 变更会触发工作台刷新信号", async () => {
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

    await act(async () => {
      if (runtime_handle === null) {
        throw new Error("运行时句柄未准备好。");
      }

      await runtime_handle.apply_project_mutation_result({
        accepted: true,
        changes: [
          {
            eventId: "analysis-mutation-1",
            source: "analysis_reset_all",
            projectPath: "E:/demo/demo.lg",
            projectRevision: 2,
            updatedSections: ["analysis"],
            sectionRevisions: {
              analysis: 2,
            },
            operations: [
              {
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
          },
        ],
      });
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

    await flush_runtime_refresh_window();

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
      itemKeys: ["1", "2"],
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

    await flush_runtime_refresh_window();

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
  });

  it("items canonical-delta 的项目身份不匹配时不会写入 ProjectStore", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/project/snapshot") {
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
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
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
    await flush_runtime_refresh_window();

    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 1,
      itemKeys: ["1"],
    });
  });

  it("items ids-only 会在刷新窗口内合并补读后推进 ProjectStore", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (path === "/api/project/items/read-by-ids") {
        expect(body).toEqual({ itemIds: [3, 4] });
        return {
          projectPath: "E:/demo/demo.lg",
          items: {
            "3": create_project_item({
              item_id: 3,
              file_path: "chapter03.txt",
              src: "foo",
              dst: "bar",
              status: "PROCESSED",
            }),
            "4": create_project_item({
              item_id: 4,
              file_path: "chapter04.txt",
              src: "hello",
              dst: "world",
              status: "PROCESSED",
            }),
          },
          missingIds: [],
          projectRevision: 5,
          sectionRevisions: { items: 5 },
          itemRevision: 5,
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
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 6,
        updatedSections: ["items"],
        sectionRevisions: { items: 6 },
        items: {
          payloadMode: "ids-only",
          changedIds: [3],
        },
      });
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 5,
        updatedSections: ["items"],
        sectionRevisions: { items: 5 },
        items: {
          payloadMode: "ids-only",
          changedIds: [4],
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await flush_runtime_refresh_window();

    await wait_for_condition(() => snapshots.at(-1)?.itemKeys.includes("4") === true);

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/items/read-by-ids", {
      itemIds: [3, 4],
    });
    expect(snapshots.at(-1)).toMatchObject({
      proofreadingReason: "translation_commit",
      proofreadingMode: "delta",
      proofreadingItemIds: [3, 4],
      itemKeys: ["1", "3", "4"],
    });
  });

  it("items ids-only 旧补读响应不会回退当前 ProjectStore", async () => {
    vi.useFakeTimers();
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (path === "/api/project/items/read-by-ids") {
        expect(body).toEqual({ itemIds: [3] });
        return {
          projectPath: "E:/demo/demo.lg",
          items: {
            "3": create_project_item({
              item_id: 3,
              file_path: "chapter03.txt",
              src: "old",
              dst: "old",
              status: "PROCESSED",
            }),
          },
          missingIds: [],
          projectRevision: 4,
          sectionRevisions: { items: 4 },
          itemRevision: 4,
        };
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
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
      );
    });

    await wait_for_condition(() => snapshots.at(-1)?.proofreadingSeq === 1);

    await act(async () => {
      event_stream.emit("project.data_changed", {
        source: "translation_commit",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 6,
        updatedSections: ["items"],
        sectionRevisions: { items: 6 },
        items: {
          payloadMode: "ids-only",
          changedIds: [3],
        },
      });
      await Promise.resolve();
    });

    await flush_runtime_refresh_window();

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/items/read-by-ids", {
      itemIds: [3],
    });
    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 1,
      itemKeys: ["1"],
    });
  });

  it("items section-invalidated 会补读 section 后再推进 store", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (
        path === "/api/project/read-sections" &&
        Array.isArray(body?.sections) &&
        body.sections.length === 1 &&
        body.sections[0] === "items"
      ) {
        return {
          projectPath: "E:/demo/demo.lg",
          projectRevision: 2,
          sectionRevisions: { items: 2 },
          sections: {
            items: {
              "2": create_project_item({
                item_id: 2,
                file_path: "chapter02.txt",
                status: "NONE",
              }),
            },
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
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
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

    await wait_for_condition(() => snapshots.at(-1)?.itemKeys.includes("2") === true);

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/read-sections", {
      sections: ["items"],
    });
    expect(snapshots.at(-1)).toMatchObject({
      proofreadingReason: "translation_reset",
      proofreadingMode: "full",
      itemKeys: ["2"],
    });
  });

  it("items section-invalidated 的旧补读响应不会回退当前 ProjectStore", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();

    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (
        path === "/api/project/read-sections" &&
        Array.isArray(body?.sections) &&
        body.sections.length === 1 &&
        body.sections[0] === "items"
      ) {
        return {
          projectPath: "E:/demo/demo.lg",
          projectRevision: 4,
          sectionRevisions: { items: 4 },
          sections: {
            items: {
              "3": create_project_item({
                item_id: 3,
                file_path: "chapter03.txt",
                status: "PROCESSED",
              }),
            },
          },
        };
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
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot);
            }}
          />
        </DesktopRuntimeProvider>,
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

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/read-sections", {
      sections: ["items"],
    });
    expect(snapshots.at(-1)).toMatchObject({
      proofreadingSeq: 1,
      itemKeys: ["1"],
    });
  });

  it("项目切换后迟到的失效补读不会写入新项目 Store", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    let runtime_handle: RuntimeHandleRef = null;
    let project_path = "E:/demo/old.lg";
    let resolve_old_items_read: ((payload: Record<string, unknown>) => void) | null = null;
    const old_items_read = new Promise<Record<string, unknown>>((resolve) => {
      resolve_old_items_read = resolve;
    });

    api_fetch_mock.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/project/snapshot") {
        return { project: { path: project_path, loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (
        path === "/api/project/read-sections" &&
        Array.isArray(body?.sections) &&
        body.sections.length === 1 &&
        body.sections[0] === "items"
      ) {
        return await old_items_read;
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
      await runtime_handle?.refresh_project_snapshot();
      await Promise.resolve();
      await Promise.resolve();
    });
    await wait_for_condition(() => snapshots.at(-1)?.projectPath === "E:/demo/next.lg");

    await act(async () => {
      resolve_old_items_read?.({
        projectPath: "E:/demo/old.lg",
        projectRevision: 2,
        sectionRevisions: { items: 2 },
        sections: {
          items: {
            "2": create_project_item({
              item_id: 2,
              file_path: "old.txt",
              src: "old",
              status: "PROCESSED",
            }),
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(snapshots.at(-1)).toMatchObject({
      projectPath: "E:/demo/next.lg",
      itemKeys: ["9"],
    });
  });

  it("项目 warmup 期间的 mutation result 与同源 SSE 会在快照后只重放一次", async () => {
    const snapshots: RuntimeSnapshot[] = [];
    const event_stream = create_event_source_stub();
    const initial_project_read = create_deferred<Record<string, unknown>>();
    let runtime_handle: RuntimeHandleRef = null;

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/settings/app") {
        return { settings: { app_language: "ZH" } };
      }
      if (path === "/api/project/snapshot") {
        return { project: { path: "E:/demo/demo.lg", loaded: true } };
      }
      if (path === "/api/tasks/snapshot") {
        return { task: { task_type: "translation", status: "idle", busy: false } };
      }
      if (path === "/api/project/manifest") {
        return create_project_read_response(path, {
          projectRevision: 1,
          sectionRevisions: { project: 1, files: 1, items: 1, analysis: 1 },
        });
      }
      if (path === "/api/project/read-sections") {
        return await initial_project_read.promise;
      }

      throw new Error(`未预期的请求：${path}`);
    });

    open_event_stream_mock.mockResolvedValue(event_stream.event_source);
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

    await wait_for_condition(() => runtime_handle !== null);
    await wait_for_condition(() =>
      has_event_stream_listener(event_stream.event_source, "project.data_changed"),
    );
    await wait_for_condition(() =>
      api_fetch_mock.mock.calls.some((call) => call[0] === "/api/project/read-sections"),
    );

    const warmup_change = {
      eventId: "warmup-mutation-1",
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
    const warmup_mutation_result = normalize_project_mutation_result({
      accepted: true,
      changes: [warmup_change],
    });

    await act(async () => {
      await runtime_handle?.apply_project_mutation_result(warmup_mutation_result);
      event_stream.emit("project.data_changed", warmup_change);
      await Promise.resolve();
    });

    await act(async () => {
      initial_project_read.resolve(
        create_project_read_response("/api/project/read-sections", {
          projectRevision: 1,
          sectionRevisions: { project: 1, files: 1, items: 1, analysis: 1 },
        }) ?? {},
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await wait_for_condition(() => snapshots.at(-1)?.itemKeys.includes("2") === true);
    expect(snapshots.at(-1)).toMatchObject({
      itemKeys: ["1", "2"],
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

    await flush_runtime_refresh_window();

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
