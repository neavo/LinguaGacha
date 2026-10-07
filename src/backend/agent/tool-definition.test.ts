import { Type } from "@earendil-works/pi-ai";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../shared/error";
import {
  AgentToolError,
  agent_tool_result,
  define_agent_tool,
  normalize_agent_tool_error,
  is_agent_cancellation,
} from "./tool-definition";

describe("Agent 工具公共边界", () => {
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

  it("业务错误保留安全修复事实，未知异常只公开稳定码", () => {
    const error = new AgentToolError({ code: "test.invalid" });
    expect(normalize_agent_tool_error(error)).toBe(error);
    const conflict = new AppError("data.revision_conflict", {
      public_details: { section: "quality", expected_revision: 2, current_revision: 3 },
    });
    expect(normalize_agent_tool_error(conflict)).toMatchObject({
      details: {
        code: "data.revision_conflict",
        section: "quality",
        expected_revision: 2,
        current_revision: 3,
      },
      cause: conflict,
      severity: "expected",
    });
    const unknown = new Error("provider secret");
    expect(normalize_agent_tool_error(unknown)).toMatchObject({
      details: { code: "tool_failed" },
      cause: unknown,
      severity: "fault",
    });
    expect(normalize_agent_tool_error(new AppError("model.provider_failed"))).toMatchObject({
      severity: "warning",
    });
  });

  it("取消要求信号与取消事实，真实故障与复合失败仍保留", async () => {
    const controller = new AbortController();
    const reason = new Error("停止");
    expect(is_agent_cancellation(reason, controller.signal)).toBe(false);
    controller.abort(reason);
    expect(is_agent_cancellation(reason, controller.signal)).toBe(true);
    expect(is_agent_cancellation(new AppError("runtime.cancelled"), controller.signal)).toBe(true);
    expect(
      is_agent_cancellation(
        new AppError("request.validation_failed", {
          diagnostic_context: { reason: "agent_message_invalidated" },
        }),
        controller.signal,
      ),
    ).toBe(true);
    expect(is_agent_cancellation(new Error("真实故障"), controller.signal)).toBe(false);
    expect(
      is_agent_cancellation(new DOMException("其它调用被取消", "AbortError"), controller.signal),
    ).toBe(false);
    const wrapped = await setTimeout(0, undefined, { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    expect(is_agent_cancellation(wrapped, controller.signal)).toBe(true);
    expect(
      is_agent_cancellation(new AggregateError([reason, new Error("刷新失败")]), controller.signal),
    ).toBe(false);
  });

  it("统一注册边界拒绝非普通对象根 Schema", () => {
    expect(() =>
      define_agent_tool({
        name: "invalid_tool",
        description: "测试",
        parameters: Type.Union([Type.Object({}), Type.Object({ value: Type.String() })], {
          type: "object",
        }),
        execute: vi.fn(),
      }),
    ).toThrow();
  });
});
