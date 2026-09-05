import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { create_agent_batch_translation_tool } from "./batch-translation";
import { normalize_batch_translation_progress } from "../../../domain/batch-translation";

describe("Agent 批量翻译工具", () => {
  it("零参数顺序工具等待完成后返回同一摘要", async () => {
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
    const tool = create_agent_batch_translation_tool(run);
    expect(tool.name).toBe("run_batch_translation");
    expect(tool.executionMode).toBe("sequential");
    const call = (args: unknown) =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "batch",
        name: tool.name,
        arguments: args,
      } as ToolCall);
    expect(call({})).toEqual({});
    expect(() => call({ item_ids: [1] })).toThrow();
    expect(() => call({ scope: "all" })).toThrow();
    const signal = new AbortController().signal;
    const settled = vi.fn();
    const result = tool
      .execute("batch", {}, signal, undefined, undefined as never)
      .then((value) => {
        settled();
        return value;
      });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(signal);
    complete();
    expect(await result).toMatchObject({
      details: summary,
      content: [{ type: "text", text: JSON.stringify(summary) }],
    });
  });
});
