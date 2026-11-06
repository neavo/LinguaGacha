import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  project_assistant_message_parts,
  read_agent_tool_calls,
  read_agent_tool_result_status,
} from "./agent-message";

it("仅工具阶段的回复公开工具调用", () => {
  const call = fauxToolCall("query", {});
  const message = fauxAssistantMessage([fauxText("准备查询"), call], { stopReason: "toolUse" });
  expect(read_agent_tool_calls(message)).toEqual([call]);
  for (const stopReason of ["aborted", "error", "length", "stop"] as const) {
    expect(read_agent_tool_calls({ ...message, stopReason })).toEqual([]);
  }
});

it("工具结果按提交诊断区分成功、失败和取消", () => {
  expect(read_agent_tool_result_status({}, { isError: false })).toBe("success");
  expect(read_agent_tool_result_status({}, { isError: true })).toBe("error");
  expect(
    read_agent_tool_result_status(
      { data: { diagnostics: [{ code: "aborted" }] } },
      { isError: true },
    ),
  ).toBe("stopped");
});

describe("助手正文投影", () => {
  it("保留可见思考与正文，过滤供应商脱敏思考", () => {
    const message = fauxAssistantMessage("正文");
    message.content.unshift(
      { type: "thinking", thinking: "可见思考" },
      { type: "thinking", thinking: "隐藏思考", redacted: true },
    );
    expect(project_assistant_message_parts(message)).toEqual([
      { kind: "thinking", text: "可见思考" },
      { kind: "text", text: "正文" },
    ]);
  });
});
