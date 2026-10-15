import { agent_tool_call } from "../../../test/agent-tool-fixture";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { create_agent_batch_item_translation_tool } from "./batch-item-translation";
import { normalize_batch_translation_progress } from "../../../domain/batch-translation";
import { BatchTranslationCompletionError } from "../../batch-translation/batch-translation-runtime";
import { AppError } from "../../../shared/error";

describe("Agent 条目批量翻译工具", () => {
  it("顺序工具传递筛选条件并等待完整结果", async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const summary = {
      status: "done" as const,
      progress: normalize_batch_translation_progress({ line: 2 }),
    };
    const run = vi.fn(async () => {
      await pending;
      return summary;
    });
    const tool = create_agent_batch_item_translation_tool(run);
    expect(tool.executionMode).toBe("sequential");
    const call = (args: unknown) =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "batch",
        name: tool.name,
        arguments: args,
      } as ToolCall);
    const request = { item_ids: [1, 2], item_statuses: ["NONE", "ERROR"] };
    expect(call(request)).toEqual(request);
    expect(() => call({ scope: { kind: "pages" }, include_errors: false })).toThrow();
    for (const invalid of [
      { item_ids: [] },
      { item_statuses: [] },
      { item_ids: [0] },
      { item_ids: [1.5] },
      { item_ids: [Number.MAX_SAFE_INTEGER + 1] },
      { item_statuses: ["ALL"] },
      { item_statuses: ["unknown"] },
    ]) {
      expect(() => call(invalid), JSON.stringify(invalid)).toThrow();
    }
    expect(call({ item_ids: [1] })).toEqual({ item_ids: [1] });
    expect(call({ item_statuses: ["PROCESSED", "EXCLUDED"] })).toEqual({
      item_statuses: ["PROCESSED", "EXCLUDED"],
    });
    const signal = new AbortController().signal;
    const settled = vi.fn();
    const result = tool.execute(request, ...agent_tool_call("batch", signal)).then((value) => {
      settled();
      return value;
    });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(request, true, signal);
    complete();
    await tool.execute(
      { ...request, thinking_downgrade: false },
      ...agent_tool_call("batch", signal),
    );
    expect(run).toHaveBeenLastCalledWith(request, false, signal);
    const expected = { status: "done", items: null, usage: null };
    expect(await result).toEqual({
      details: expected,
      output: [{ type: "text", text: JSON.stringify(expected) }],
    });
  });

  it.each(["done", "stopped", "error"] as const)("%s 回执包含本次条目和用量", async (status) => {
    const summary = {
      status,
      ...(status === "done" ? {} : { stop_source: "user" as const }),
      progress: normalize_batch_translation_progress({ total_line: 100, processed_line: 80 }),
      run_progress: normalize_batch_translation_progress({
        total_line: status === "done" ? 8 : 10,
        line: 8,
        processed_line: 6,
        error_line: 2,
        time: 12.5,
        total_input_tokens: 1000,
        total_reasoning_tokens: 200,
        total_output_tokens: 300,
        total_tokens: 1500,
      }),
    };
    const expected = {
      status,
      ...(status === "done" ? {} : { stop_source: "user" }),
      items: {
        total: status === "done" ? 8 : 10,
        succeeded: 6,
        failed: 2,
        unfinished: status === "done" ? 0 : 2,
      },
      usage: {
        elapsed_seconds: 12.5,
        input_tokens: 1000,
        reasoning_tokens: 200,
        output_tokens: 300,
        total_tokens: 1500,
      },
    };
    const cause = new AppError("model.provider_failed", {
      message: "reasoning effort is not supported",
      public_details: { status: 400 },
    });
    const failure = new BatchTranslationCompletionError(summary, cause);
    const tool = create_agent_batch_item_translation_tool(async () => {
      if (status === "error") throw failure;
      return summary;
    });
    const result = tool.execute({ item_ids: [1] }, ...agent_tool_call("batch"));
    if (status === "error") {
      const { status: _status, ...summary_details } = expected;
      // 错误回执的 `status` 属于失败原因，不被运行状态覆盖。
      const details = {
        code: "model.provider_failed",
        message: "reasoning effort is not supported",
        status: 400,
        ...summary_details,
      };
      await expect(result).rejects.toMatchObject({
        details,
        message: JSON.stringify(details),
        severity: "warning",
        cause: failure,
      });
    } else {
      expect(await result).toEqual({
        details: expected,
        output: [{ type: "text", text: JSON.stringify(expected) }],
      });
    }
  });

  it("已确定零目标返回零计数", async () => {
    const tool = create_agent_batch_item_translation_tool(async () => ({
      status: "done",
      progress: normalize_batch_translation_progress({ total_line: 100 }),
      run_progress: normalize_batch_translation_progress({}),
    }));
    expect(await tool.execute({ item_ids: [1] }, ...agent_tool_call("batch"))).toMatchObject({
      details: {
        items: { total: 0, succeeded: 0, failed: 0, unfinished: 0 },
        usage: {
          elapsed_seconds: 0,
          input_tokens: 0,
          reasoning_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      },
    });
  });
});
