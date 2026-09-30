import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { create_agent_doing_tool } from "./doing";

describe("doing 工具", () => {
  it("SDK 准备参数后写入会话，并返回设置与清空结果", async () => {
    const write = vi.fn();
    const tool = create_agent_doing_tool(write);
    for (const text of ["检查章节", null]) {
      const params = validateToolArguments(tool, {
        type: "toolCall",
        id: "doing-1",
        name: "doing",
        arguments: tool.prepareArguments!({ text }),
      } as ToolCall);
      const result = await tool.execute("doing-1", params, undefined, undefined, {} as never);
      expect(result.details).toEqual({ text });
      expect(write).toHaveBeenLastCalledWith(text);
    }
  });

  it("`doing` 拒绝空字符串和额外字段", () => {
    const tool = create_agent_doing_tool(vi.fn());
    expect(() => tool.prepareArguments!({ text: "" })).toThrowError(
      expect.objectContaining({ details: { code: "invalid_doing" }, cause: expect.any(TypeError) }),
    );
    expect(() =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "doing-1",
        name: "doing",
        arguments: tool.prepareArguments!({ text: null, extra: true }),
      } as ToolCall),
    ).toThrow();
  });

  it("取消调用不写入会话", async () => {
    const write = vi.fn();
    const tool = create_agent_doing_tool(write);
    const controller = new AbortController();
    const reason = new Error("停止");
    controller.abort(reason);
    await expect(
      tool.execute("doing-1", { text: null }, controller.signal, undefined, {} as never),
    ).rejects.toBe(reason);
    expect(write).not.toHaveBeenCalled();
  });
});
