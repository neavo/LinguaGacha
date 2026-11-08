import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { agent_tool_call } from "../../../test/agent-tool-fixture";
import {
  project_model_configs,
  type BatchRequestSummary,
} from "../../batch-request/batch-request-service";
import { create_agent_batch_llm_request_tool } from "./batch-llm-request";

it("配置投影的身份通过新参数传入批量工具，旧参数不再接受", async () => {
  const [config] = project_model_configs({
    models: [{ id: "saved-config", name: "Fixture", model_id: "vendor-model" }],
  });
  expect(config).toMatchObject({ model_config_id: "saved-config", model_id: "vendor-model" });
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
  const request = { model_config_id: config!.model_config_id, request_file: "work/requests.json" };
  expect(validate(request)).toEqual(request);
  expect(() =>
    validate({ config_id: "saved-config", manifest_file: "work/requests.json" }),
  ).toThrow();
  const signal = new AbortController().signal;
  const result = await tool.execute(request, ...agent_tool_call("batch", signal));
  expect(run).toHaveBeenCalledWith("saved-config", "work/requests.json", signal);
  expect(result.details).toEqual(summary);
});
