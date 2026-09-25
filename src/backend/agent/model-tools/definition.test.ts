import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../../shared/error";
import { set_main_log_language_reader } from "../../log/log-text";
import { AgentToolError, agent_tool_result, prepare_agent_tool } from "./definition";

describe("Agent 工具公共边界", () => {
  afterEach(() => {
    set_main_log_language_reader(null);
    vi.restoreAllMocks();
  });

  it("成功正文与 details 共用严格 JSON", () => {
    const details = { status: "applied", values: [1, 2] };
    const result = agent_tool_result(details);

    expect(result.details).toBe(details);
    expect(JSON.parse(result.content[0]!.text)).toEqual(details);
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
});
