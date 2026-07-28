import { describe, expect, it, vi } from "vitest";

import { TaskLogReplay } from "./log-replay";
import type { LogManager } from "../../log/log-manager";

/**
 * 构造只含日志写入口的 LogManager 替身，避免测试碰真实文件日志。
 */
function create_log_manager_stub(): Pick<LogManager, "append"> {
  return {
    append: vi.fn(() => null),
  };
}

describe("TaskLogReplay", () => {
  it("输出任务启动和结束日志到统一 LogManager", () => {
    const log_manager = create_log_manager_stub();
    const replay = new TaskLogReplay(log_manager);

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

    expect(log_manager.append).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        content: { kind: "text", text: "" },
        source: "engine",
      }),
    );
    expect(log_manager.append).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { kind: "text", text: expect.stringContaining("OpenAI") },
        source: "engine",
      }),
    );
    expect(log_manager.append).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { kind: "text", text: "system prompt" },
        source: "engine",
      }),
    );
    expect(log_manager.append).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { kind: "text", text: expect.stringContaining("已完成") },
        source: "engine",
      }),
    );
  });

  it("回放 worker 日志并保留结构化错误字段", () => {
    const log_manager = create_log_manager_stub();
    const replay = new TaskLogReplay(log_manager);

    replay.work_unit_logs([
      {
        level: "warning",
        content: {
          kind: "translation_result",
          summary: ["worker warning"],
          sections: [],
          pairs: [{ src: "原文", dst: "译文" }],
        },
        error: {
          message: "provider failed",
          stack: "stack",
        },
      },
    ]);

    expect(log_manager.append).toHaveBeenCalledWith({
      level: "warning",
      content: {
        kind: "translation_result",
        summary: ["worker warning"],
        sections: [],
        pairs: [{ src: "原文", dst: "译文" }],
      },
      source: "engine-worker",
      error: {
        message: "provider failed",
        stack: "stack",
      },
    });
  });

  it("任务异常写入诊断字段而不是拼进 message", () => {
    const log_manager = create_log_manager_stub();
    const replay = new TaskLogReplay(log_manager);

    replay.task_error("任务执行失败", new Error("provider timeout"));

    expect(log_manager.append).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        content: { kind: "text", text: "任务执行失败" },
        source: "engine",
        error: expect.objectContaining({
          message: "provider timeout",
          stack: expect.any(String),
        }),
      }),
    );
  });
});
