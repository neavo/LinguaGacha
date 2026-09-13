import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { project_assistant_message_parts } from "./agent-message";

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
