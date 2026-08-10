import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../shared/error";
import type { FileLogWriter } from "../log/log-manager";
import { LogManager } from "../log/log-manager";
import { set_main_log_language_reader } from "../log/log-text";
import {
  AgentToolError,
  agent_tool_result,
  log_agent_tool_event,
  wrap_agent_tool_execution,
} from "./agent-tool";

describe("Agent 工具公共边界", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    set_main_log_language_reader(null);
    while (cleanup_callbacks.length > 0) await cleanup_callbacks.pop()?.();
    vi.restoreAllMocks();
  });

  it("成功正文与 details 共用严格 JSON", () => {
    const details = { status: "applied", values: [1, 2] };
    const result = agent_tool_result(details);

    expect(result.details).toBe(details);
    expect(JSON.parse(result.content[0].text)).toEqual(details);
  });

  it("业务错误的 message 可还原稳定 details", () => {
    const error = new AgentToolError({ code: "quality_rule.invalid_change", path: "write[0]" });

    expect(JSON.parse(error.message)).toEqual(error.details);
  });

  it("执行包装只为非预期异常记录本地化原始诊断", async () => {
    set_main_log_language_reader(() => "EN");
    const error = vi.fn();
    const execute = vi.fn();
    const wrapped = wrap_agent_tool_execution(
      defineTool({
        name: "test_tool",
        label: "测试",
        description: "测试",
        parameters: Type.Object({}),
        execute,
      }),
      { error },
    );

    const tool_error = new AgentToolError({ code: "test.invalid" });
    execute.mockRejectedValueOnce(tool_error);
    await expect(
      wrapped.execute("domain", {}, undefined, undefined, undefined as never),
    ).rejects.toBe(tool_error);

    const validation_error = new AppError("request.validation_failed");
    execute.mockRejectedValueOnce(validation_error);
    await expect(
      wrapped.execute("validation", {}, undefined, undefined, undefined as never),
    ).rejects.toMatchObject({ details: { code: validation_error.code } });

    execute.mockRejectedValueOnce(
      new AppError("data.revision_conflict", {
        public_details: { section: "quality", expected_revision: 2, current_revision: 3 },
      }),
    );
    await expect(
      wrapped.execute("revision", {}, undefined, undefined, undefined as never),
    ).rejects.toMatchObject({
      details: {
        code: "data.revision_conflict",
        section: "quality",
        expected_revision: 2,
        current_revision: 3,
      },
    });
    expect(error).not.toHaveBeenCalled();

    const provider_error = new AppError("model.provider_failed");
    execute.mockRejectedValueOnce(provider_error);
    await expect(
      wrapped.execute("warning", {}, undefined, undefined, undefined as never),
    ).rejects.toMatchObject({ details: { code: "model.provider_failed" } });
    expect(error).toHaveBeenLastCalledWith("Agent tool execution failed …", {
      source: "agent",
      error: provider_error,
      context: { tool_call_id: "warning", tool_name: "test_tool" },
    });

    const unknown = new Error("provider secret");
    execute.mockRejectedValueOnce(unknown);
    await expect(
      wrapped.execute("unknown", {}, undefined, undefined, undefined as never),
    ).rejects.toMatchObject({ details: { code: "tool_failed" } });
    expect(error).toHaveBeenLastCalledWith("Agent tool execution failed …", {
      source: "agent",
      error: unknown,
      context: { tool_call_id: "unknown", tool_name: "test_tool" },
    });
  });

  it("start/end 使用稳定 source、等级、目标与完整严格 JSON", () => {
    const append = vi.fn();
    const input = { query: "x".repeat(5_000), items: Array.from({ length: 30 }, (_, i) => i) };
    const output = {
      content: [{ type: "text", text: "web正文".repeat(2_000) }],
      details: { content: "skill正文".repeat(2_000) },
    };

    log_agent_tool_event({ append }, tool_start("call-1", "web_fetch", input));
    log_agent_tool_event({ append }, tool_end("call-1", "web_fetch", output, true));

    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      level: "info",
      source: "agent-tool",
      targets: { file: true, console: false, window: false },
    });
    expect(append.mock.calls[1]?.[0]).toMatchObject({
      level: "error",
      source: "agent-tool",
      targets: { file: true, console: false, window: false },
    });
    expect(JSON.parse(append.mock.calls[0]?.[0].content.text)).toEqual({
      event: "start",
      tool_call_id: "call-1",
      tool_name: "web_fetch",
      input,
    });
    expect(JSON.parse(append.mock.calls[1]?.[0].content.text)).toEqual({
      event: "end",
      tool_call_id: "call-1",
      tool_name: "web_fetch",
      is_error: true,
      output,
    });
  });

  it("真实 LogManager 不裁剪调用正文且不写控制台和窗口", () => {
    const file_lines: string[] = [];
    const console_lines: string[] = [];
    const log_manager = create_log_manager(file_lines, console_lines);
    const window_events = vi.fn();
    log_manager.subscribe(window_events, { replay: false });
    const input = { text: "i".repeat(5_000), items: Array.from({ length: 30 }, (_, i) => i) };
    const output = {
      content: [{ type: "text", text: "w".repeat(5_000) }],
      details: { skill: "s".repeat(5_000) },
    };

    log_agent_tool_event(log_manager, tool_start("long", "read_skill", input));
    log_agent_tool_event(log_manager, tool_end("long", "read_skill", output, false));

    const records = file_lines.map((line) => JSON.parse(line) as { message: string });
    expect(JSON.parse(records[0]?.message ?? "{}").input).toEqual(input);
    expect(JSON.parse(records[1]?.message ?? "{}").output).toEqual(output);
    expect(console_lines).toEqual([]);
    expect(window_events).not.toHaveBeenCalled();
  });

  it("非工具 SDK 事件不产生日志", () => {
    const append = vi.fn();
    log_agent_tool_event({ append }, { type: "agent_start" } as AgentSessionEvent);
    expect(append).not.toHaveBeenCalled();
  });

  function create_log_manager(file_lines: string[], console_lines: string[]): LogManager {
    const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-tool-test-"));
    const file_writer: FileLogWriter = { write: (text) => file_lines.push(text) };
    const log_manager = new LogManager({
      logDir: log_dir,
      fileWriter: file_writer,
      consoleWriter: (text) => console_lines.push(text),
    });
    cleanup_callbacks.push(() => fs.rmSync(log_dir, { force: true, recursive: true }));
    cleanup_callbacks.push(() => log_manager.shutdown());
    return log_manager;
  }
});

function tool_start(tool_call_id: string, tool_name: string, input: unknown): AgentSessionEvent {
  return {
    type: "tool_execution_start",
    toolCallId: tool_call_id,
    toolName: tool_name,
    args: input,
  };
}

function tool_end(
  tool_call_id: string,
  tool_name: string,
  output: unknown,
  is_error: boolean,
): AgentSessionEvent {
  return {
    type: "tool_execution_end",
    toolCallId: tool_call_id,
    toolName: tool_name,
    result: output,
    isError: is_error,
  };
}
