import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { agent_tool_call } from "../../../test/agent-tool-fixture";
import type { BatchRequestSummary } from "../../batch-request/batch-request-service";
import { create_agent_batch_llm_request_tool } from "./batch-llm-request";

it("三个用途可调用，旧格式与未知用途在派发前拒绝", async () => {
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
  const validate = (args: unknown) =>
    validateToolArguments(tool, {
      type: "toolCall",
      id: "batch",
      name: tool.name,
      arguments: args,
    } as ToolCall);
  const request = {
    model_usage: "agent",
    request_file: "work/requests.json",
  };
  expect(validate(request)).toEqual(request);
  const signal = new AbortController().signal;
  const result = await tool.execute(request, ...agent_tool_call("batch", signal));
  expect(run).toHaveBeenCalledWith(request, signal);
  expect(result.details).toEqual(summary);
  for (const model_usage of ["agent_batch_translation", "agent_media"]) {
    const media = { model_usage, request_file: "work/requests.json" };
    expect(validate(media)).toEqual(media);
    await tool.execute(media, ...agent_tool_call("media", signal));
    expect(run).toHaveBeenLastCalledWith(media, signal);
  }
  for (const invalid of [
    { request_file: "x" },
    { model: { usage: "media" }, request_file: "x" },
    { model: { config_id: "saved-config" }, request_file: "x" },
    { model_usage: "agent_media", request_file: "" },
    { model_usage: "agent_media", request_file: "  " },
    { model_usage: "other", request_file: "x" },
  ])
    expect(() => validate(invalid)).toThrow();
});
