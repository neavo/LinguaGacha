import { describe, expect, it, vi } from "vitest";

import { TaskLogReplay } from "./log-replay";
import type { LogManager } from "../../log/log-manager";

/**
 * 构造只含日志写入口的 LogManager 替身，避免测试碰真实文件日志。
 */
function create_log_manager_stub(): Pick<LogManager, "info" | "warning" | "error"> {
  return {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}

describe("TaskLogReplay", () => {
  it("输出任务启动和结束日志到统一 LogManager", () => {
    const log_manager = create_log_manager_stub();
    const replay = new TaskLogReplay(log_manager as LogManager);

    replay.task_run_start(
      {
        name: "OpenAI",
        api_url: "https://api.example.com",
        model_id: "gpt-test",
      },
      "zh-CN",
      "system prompt",
    );
    replay.task_run_finish("done", "zh-CN");

    expect(log_manager.info).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ source: "engine" }),
    );
    expect(log_manager.info).toHaveBeenCalledWith(
      expect.stringContaining("OpenAI"),
      expect.objectContaining({ source: "engine" }),
    );
    expect(log_manager.info).toHaveBeenCalledWith(
      "system prompt",
      expect.objectContaining({ source: "engine" }),
    );
    expect(log_manager.info).toHaveBeenCalledWith(
      expect.stringContaining("已完成"),
      expect.objectContaining({ source: "engine" }),
    );
  });

  it("回放 worker 日志并保留结构化错误字段", () => {
    const log_manager = create_log_manager_stub();
    const replay = new TaskLogReplay(log_manager as LogManager);

    replay.work_unit_logs([
      {
        level: "warning",
        message: "worker warning",
        error: {
          message: "provider failed",
          stack: "stack",
        },
        context: {
          unit: "unit-1",
        },
      },
    ]);

    expect(log_manager.warning).toHaveBeenCalledWith("worker warning", {
      source: "engine-worker",
      error: {
        message: "provider failed",
        stack: "stack",
      },
      context: {
        unit: "unit-1",
      },
    });
  });

  it("任务异常写入诊断字段而不是拼进 message", () => {
    const log_manager = create_log_manager_stub();
    const replay = new TaskLogReplay(log_manager as LogManager);

    replay.task_error("任务执行失败", new Error("provider timeout"));

    expect(log_manager.error).toHaveBeenCalledWith(
      "任务执行失败",
      expect.objectContaining({
        source: "engine",
        error: expect.objectContaining({
          message: "provider timeout",
          stack: expect.any(String),
        }),
      }),
    );
  });
});
