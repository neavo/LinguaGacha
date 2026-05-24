import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectUiWorkerRequest } from "@/project/worker/project-ui-worker-protocol";

// WorkerScopeHarness 固定 DedicatedWorkerGlobalScope 的消息通道和响应出口。
type WorkerScopeHarness = {
  listener: ((event: MessageEvent<ProjectUiWorkerRequest>) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  emit: (request: ProjectUiWorkerRequest) => void;
};

// DedicatedWorkerGlobalScope 只模拟 message 通道，避免测试依赖浏览器 Worker 实例。
function install_worker_scope_mock(): WorkerScopeHarness {
  const harness: WorkerScopeHarness = {
    listener: null,
    postMessage: vi.fn(),
    // emit 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    emit(request) {
      harness.listener?.({ data: request } as MessageEvent<ProjectUiWorkerRequest>);
    },
  };
  const worker_scope = {
    addEventListener: vi.fn(
      (event_name: string, listener: (event: MessageEvent<ProjectUiWorkerRequest>) => void) => {
        if (event_name === "message") {
          harness.listener = listener;
        }
      },
    ),
    postMessage: harness.postMessage,
  };

  vi.stubGlobal("self", worker_scope);

  return harness;
}

// worker 入口读取全局 self 并立即注册监听，必须在 scope mock 后导入。
async function import_worker_entry(): Promise<void> {
  await import("./project-ui-worker-entry");
}

// 请求执行包在 async IIFE 中，flush 后才能断言 postMessage。
async function flush_worker_microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("project-ui-worker-entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock("@/project/quality/quality-statistics");
    vi.doUnmock("@/project/worker/proofreading-ui-worker-service");
  });

  it("将质量统计请求分发到 worker 任务并按协议返回结果", async () => {
    const harness = install_worker_scope_mock();
    const compute_statistics = vi.fn(async () => {
      return {
        results: {
          rule1: {
            matched_item_count: 1,
            subset_parents: [],
          },
        },
      };
    });
    vi.doMock("@/project/quality/quality-statistics", () => {
      return {
        run_quality_statistics_task: compute_statistics,
      };
    });
    vi.doMock("@/project/worker/proofreading-ui-worker-service", () => {
      return {
        createProofreadingUiWorkerService: () => ({
          dispose_project: vi.fn(),
        }),
      };
    });

    await import_worker_entry();

    const input = {
      rules: [],
      srcTexts: ["源文"],
      dstTexts: ["译文"],
      relationCandidates: [],
    };
    harness.emit({
      id: 1,
      type: "quality.compute_statistics",
      input,
    });
    await flush_worker_microtasks();

    expect(compute_statistics).toHaveBeenCalledWith(input);
    expect(harness.postMessage).toHaveBeenCalledWith({
      id: 1,
      ok: true,
      result: {
        results: {
          rule1: {
            matched_item_count: 1,
            subset_parents: [],
          },
        },
      },
    });
  });

  it("校对派生服务抛错时返回带消息类型的结构化诊断", async () => {
    const harness = install_worker_scope_mock();
    const dispose_project = vi.fn(() => {
      throw new Error("dispose_failed");
    });
    vi.doMock("@/project/quality/quality-statistics", () => {
      return {
        run_quality_statistics_task: vi.fn(),
      };
    });
    vi.doMock("@/project/worker/proofreading-ui-worker-service", () => {
      return {
        createProofreadingUiWorkerService: () => ({
          dispose_project,
        }),
      };
    });

    await import_worker_entry();

    harness.emit({
      id: 2,
      type: "project.dispose",
      input: { projectId: "demo-project" },
    });
    await flush_worker_microtasks();

    expect(dispose_project).toHaveBeenCalledWith("demo-project");
    expect(harness.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        ok: false,
        error_diagnostic: expect.objectContaining({
          message: "dispose_failed",
          context: expect.objectContaining({
            worker_message_type: "project.dispose",
          }),
        }),
      }),
    );
  });
});
