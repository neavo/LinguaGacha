import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { agent_tool_call } from "../../../test/agent-tool-fixture";
import type { BatchRequestSummary } from "../../batch-request/batch-request-service";
import { create_agent_batch_llm_request_tool } from "./batch-llm-request";

it("显式配置与音视频用途互斥，合法参数传给批量执行入口", async () => {
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
    model: { config_id: "saved-config" },
    request_file: "work/requests.json",
  };
  expect(validate(request)).toEqual(request);
  const signal = new AbortController().signal;
  const result = await tool.execute(request, ...agent_tool_call("batch", signal));
  expect(run).toHaveBeenCalledWith(request, signal);
  expect(result.details).toEqual(summary);
  const media = { model: { usage: "media" }, request_file: "work/requests.json" };
  expect(validate(media)).toEqual(media);
  await tool.execute(media, ...agent_tool_call("media", signal));
  expect(run).toHaveBeenLastCalledWith(media, signal);
  for (const invalid of [
    { request_file: "x" },
    { model: { usage: "media" } },
    { model: { usage: "media", config_id: "saved-config" }, request_file: "x" },
    { model: {}, request_file: "x" },
    { model: { usage: "other" }, request_file: "x" },
    { model: { usage: "media" }, request_file: "" },
    { model: { usage: "media" }, request_file: "  " },
  ])
    expect(() => validate(invalid)).toThrow();
});
