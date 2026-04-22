// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAnalysisTaskRuntime } from "@/app/state/use-analysis-task-runtime";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
  };
});

const run_modal_progress_toast_mock = vi.fn(
  async <T,>(args: { message: string; task: () => Promise<T> }): Promise<T> => {
    return await args.task();
  },
);

type RuntimeFixture = {
  project_store: {
    getState: () => Record<string, unknown>;
  };
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  workbench_change_signal: {
    seq: number;
    reason: string;
  };
  set_task_snapshot: ReturnType<typeof vi.fn>;
  task_snapshot: Record<string, unknown>;
  commit_local_project_patch: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  align_project_runtime_ack: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(
    create_task_snapshot({
      status: "RUN",
      busy: true,
    }),
  ),
};

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/state/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/state/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      run_modal_progress_toast: run_modal_progress_toast_mock,
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
    task_type: "analysis",
    status: "IDLE",
    busy: false,
    request_in_flight_count: 0,
    line: 0,
    total_line: 10,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
    analysis_candidate_count: 0,
    ...overrides,
  };
}

function create_runtime_fixture(task_snapshot: Record<string, unknown>): RuntimeFixture {
  return {
    project_store: {
      getState: () => ({
        quality: {
          glossary: {
            entries: [],
            enabled: true,
            mode: "custom",
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
      }),
    },
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    workbench_change_signal: {
      seq: 0,
      reason: "idle",
    },
    set_task_snapshot: vi.fn(),
    task_snapshot,
    commit_local_project_patch: vi.fn(),
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
  on_ready: (state: ReturnType<typeof useAnalysisTaskRuntime>) => void;
}): JSX.Element | null {
  const state = useAnalysisTaskRuntime();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useAnalysisTaskRuntime", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useAnalysisTaskRuntime> | null = null;

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
    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "RUN",
        busy: true,
      }),
    );
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    run_modal_progress_toast_mock.mockClear();
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

  it("分析完成且存在候选术语时自动弹出导入确认框", async () => {
    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === "/api/v2/tasks/snapshot") {
        return {
          task: runtime_fixture.current.task_snapshot,
        };
      }

      throw new Error(`未预期的请求：${path}`);
    });

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.analysis_confirm_state).toBeNull();

    runtime_fixture.current = create_runtime_fixture(
      create_task_snapshot({
        status: "DONE",
        busy: false,
        line: 10,
        processed_line: 10,
        analysis_candidate_count: 2,
      }),
    );

    await render_probe();
    await flush_microtasks();

    expect(latest_state?.analysis_confirm_state).toMatchObject({
      kind: "import-glossary",
      open: true,
      submitting: false,
    });
    expect(push_toast_mock).toHaveBeenCalledWith(
      "success",
      "workbench_page.analysis_task.feedback.done",
    );
  });
});
