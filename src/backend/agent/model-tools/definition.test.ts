import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../../shared/error";
import { LogManager } from "../../log/log-manager";
import { set_main_log_language_reader } from "../../log/log-text";
import {
  AgentToolError,
  agent_tool_result,
  log_agent_tool_event,
  prepare_agent_tool,
} from "./definition";

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
    const wrapped = prepare_agent_tool(
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

  it("统一注册边界拒绝非普通对象根 Schema", () => {
    const invalid = defineTool({
      name: "invalid_tool",
      label: "非法工具",
      description: "测试",
      parameters: Type.Union([Type.Object({}), Type.Object({ value: Type.String() })], {
        type: "object",
      }),
      execute: vi.fn(),
    });

    expect(() => prepare_agent_tool(invalid, { error: vi.fn() })).toThrow();
  });

  it("start/end 使用稳定 source、等级、目标与完整严格 JSON", () => {
    const append = vi.fn();
    const input = { query: "x".repeat(5_000), items: Array.from({ length: 30 }, (_, i) => i) };
    const output = {
      content: [{ type: "text", text: "web正文".repeat(2_000) }],
      details: { content: "skill正文".repeat(2_000) },
    };

    log_agent_tool_event({ append }, tool_start("call-1", "web_search", input));
    log_agent_tool_event({ append }, tool_end("call-1", "web_search", output, true));

    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      level: "info",
      source: "agent-tool",
      targets: { console: false, window: false },
    });
    expect(append.mock.calls[1]?.[0]).toMatchObject({
      level: "error",
      source: "agent-tool",
      targets: { console: false, window: false },
    });
    expect(JSON.parse(append.mock.calls[0]?.[0].content.text)).toEqual({
      event: "start",
      tool_call_id: "call-1",
      tool_name: "web_search",
      input,
    });
    expect(JSON.parse(append.mock.calls[1]?.[0].content.text)).toEqual({
      event: "end",
      tool_call_id: "call-1",
      tool_name: "web_search",
      is_error: true,
      output,
    });
  });

  it("真实 LogManager 不裁剪调用正文且不写控制台和窗口", async () => {
    const console_lines: string[] = [];
    const { log_manager, log_dir } = create_log_manager(console_lines);
    const input = { text: "i".repeat(5_000), items: Array.from({ length: 30 }, (_, i) => i) };
    const output = {
      content: [{ type: "text", text: "w".repeat(5_000) }],
      details: { skill: "s".repeat(5_000) },
    };

    log_agent_tool_event(log_manager, tool_start("long", "read_skill", input));
    log_agent_tool_event(log_manager, tool_end("long", "read_skill", output, false));

    const records = fs
      .readFileSync(path.join(log_dir, `app.${log_manager.files.list_dates()[0]!}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { content: { text: string } });
    expect(JSON.parse(records[0]?.content.text ?? "{}").input).toEqual(input);
    expect(JSON.parse(records[1]?.content.text ?? "{}").output).toEqual(output);
    expect(console_lines).toEqual([]);
    expect(
      (
        await log_manager.files.read_page({
          date: log_manager.files.list_dates()[0]!,
          direction: "latest",
        })
      ).entries,
    ).toEqual([]);
  });

  it("非工具 SDK 事件不产生日志", () => {
    const append = vi.fn();
    log_agent_tool_event({ append }, { type: "agent_start" } as AgentSessionEvent);
    expect(append).not.toHaveBeenCalled();
  });

  /** 使用独立临时目录，避免测试写入用户日志。 */
  function create_log_manager(console_lines: string[]): {
    log_manager: LogManager;
    log_dir: string;
  } {
    const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-tool-test-"));
    const log_manager = new LogManager({
      logDir: log_dir,
      consoleWriter: (text) => console_lines.push(text),
    });
    cleanup_callbacks.push(() => fs.rmSync(log_dir, { force: true, recursive: true }));
    cleanup_callbacks.push(() => log_manager.shutdown());
    return { log_manager, log_dir };
  }
});

/** 构造工具开始事件，保留 SDK 入口形状。 */
function tool_start(tool_call_id: string, tool_name: string, input: unknown): AgentSessionEvent {
  return {
    type: "tool_execution_start",
    toolCallId: tool_call_id,
    toolName: tool_name,
    args: input,
  };
}

/** 构造工具结束事件，覆盖成功与失败输出。 */
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
