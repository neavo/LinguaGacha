import assert from "node:assert/strict";
import { Model } from "../domain/model.ts";
import { read_model_request_snapshot } from "../backend/llm/llm-request.ts";
import { resolve_one_shot_pi_request } from "../backend/llm/llm-pi.ts";
import { resolve_model_capability } from "../backend/llm/model-capability.ts";

// 自有模型名与成功响应覆盖 SDK 加载和流读取，协议细节由对应业务测试负责。
const responses = [
  {
    format: "OpenAI",
    events: [
      {
        choices: [
          { index: 0, delta: { role: "assistant", content: "pong" }, finish_reason: "stop" },
        ],
      },
    ],
  },
  {
    format: "OpenAIResponses",
    events: [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "message", role: "assistant", content: [] },
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "pong" },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          id: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "pong", annotations: [] }],
        },
      },
      { type: "response.completed", response: { id: "fixture", status: "completed" } },
    ],
  },
  {
    format: "Anthropic",
    events: [
      {
        type: "message_start",
        message: { id: "fixture", usage: { input_tokens: 1, output_tokens: 0 } },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "pong" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ],
  },
  {
    format: "Google",
    events: [
      {
        candidates: [
          { index: 0, content: { role: "model", parts: [{ text: "pong" }] }, finishReason: "STOP" },
        ],
      },
    ],
  },
];

for (const fixture of responses) {
  const model = Model.from_json(
    {
      api_format: fixture.format,
      model_id: "fixture",
      api_key: "fixture",
      api_url: "https://fixture.example/v1",
      thinking: { level: "OFF" },
    },
    "fixture",
  );
  const snapshot = read_model_request_snapshot(model.to_json(), { user_agent: "release-test" });
  const request = resolve_one_shot_pi_request(
    snapshot,
    [{ role: "user", content: "ping" }],
    new AbortController().signal,
    resolve_model_capability(model, []),
  );
  // 夹具在独立进程执行，fetch 替换随进程退出释放。
  globalThis.fetch = async () =>
    new Response(
      fixture.events
        .map(
          (event) =>
            (event.type ? `event: ${event.type}\n` : "") + `data: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  const completed = await request.stream(request.model, request.context, request.options).result();
  assert.equal(completed.stopReason, "stop", `${fixture.format}: ${completed.errorMessage}`);
  assert.equal(
    completed.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
    "pong",
    fixture.format,
  );
}
