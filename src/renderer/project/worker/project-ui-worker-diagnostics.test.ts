import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectUiWorkerClientError } from "@/project/worker/project-ui-worker-errors";
import { capture_project_ui_worker_error } from "@/project/worker/project-ui-worker-diagnostics";

// capture renderer error mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const capture_renderer_error_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/diagnostics/renderer-error-reporter", () => {
  return {
    capture_renderer_error: capture_renderer_error_mock,
  };
});

describe("capture_project_ui_worker_error", () => {
  beforeEach(() => {
    capture_renderer_error_mock.mockClear();
  });

  it("上报 worker execution_failed 时保留 worker 返回的结构化诊断", () => {
    const captured = capture_project_ui_worker_error(
      new ProjectUiWorkerClientError("execution_failed", {
        name: "Error",
        message: "worker 爆炸",
        stack: "Error: worker 爆炸\n    at run",
        context: {
          worker_message_type: "quality.compute_statistics",
        },
      }),
      {
        context: {
          page: "proofreading",
        },
      },
    );

    expect(captured).toBe(true);
    expect(capture_renderer_error_mock).toHaveBeenCalledWith(
      expect.any(ProjectUiWorkerClientError),
      {
        source: "worker",
        logError: {
          name: "Error",
          message: "worker 爆炸",
          stack: "Error: worker 爆炸\n    at run",
          context: {
            worker_message_type: "quality.compute_statistics",
          },
        },
        context: {
          page: "proofreading",
        },
      },
    );
  });

  it("stale worker 请求属于正常退场，不写 renderer 异常诊断", () => {
    const captured = capture_project_ui_worker_error(new ProjectUiWorkerClientError("stale"), {
      context: {
        page: "proofreading",
      },
    });

    expect(captured).toBe(false);
    expect(capture_renderer_error_mock).not.toHaveBeenCalled();
  });
});
