import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { agent_tool_call } from "../../../test/agent-tool-fixture";
import type { BatchRequestSummary } from "../../batch-request/batch-request-service";
import { create_agent_batch_llm_request_tool } from "./batch-llm-request";

it("按用途派发请求，无效参数在派发前拒绝", async () => {
  const summary: BatchRequestSummary = {
    run_id: "run",
    status: "done",
    total: 1,
    succeeded: 1,
    failed: 0,
    unfinished: 0,
    usage: null,
    result_file: "work/batch-requests/run/result.json",
  };
  const run = vi.fn(async () => summary);
  const tool = create_agent_batch_llm_request_tool(run);
  // 通过 SDK 校验入口观察参数契约。
  const validate = (args: unknown) =>
    validateToolArguments(tool, {
      type: "toolCall",
      id: "batch",
      name: tool.name,
      arguments: args,
    } as ToolCall);
  const signal = new AbortController().signal;
  for (const request of [
    { model_usage: "agent", request_file: "work/requests.json" },
    { model_usage: "media", request_file: "work/requests.json", thinking_downgrade: true },
  ]) {
    expect(validate(request)).toEqual(request);
    const result = await tool.execute(request, ...agent_tool_call("batch", signal));
    expect(run).toHaveBeenLastCalledWith(request, signal);
    expect(result.details).toEqual(summary);
  }
  for (const invalid of [
    { model_usage: "media", request_file: "x", thinking_downgrade: "invalid" },
    { request_file: "x" },
    { model: { usage: "media" }, request_file: "x" },
    { model: { config_id: "saved-config" }, request_file: "x" },
    { model_usage: "media", request_file: "" },
    { model_usage: "media", request_file: "  " },
    { model_usage: "batch_translation", request_file: "x" },
    { model_usage: "other", request_file: "x" },
  ])
    expect(() => validate(invalid)).toThrow();
});
