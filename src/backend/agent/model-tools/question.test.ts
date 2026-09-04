import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { create_agent_question_tools } from "./question";

type QuestionToolResult = { details: unknown };

describe("ask_user 工具", () => {
  it("公开单题固定选项并返回宿主决定", async () => {
    const wait_for_answer = vi.fn(async () => ({
      outcome: "selected" as const,
      optionId: "focused",
    }));
    const tool = create_agent_question_tools({ wait_for_answer })[0];
    if (tool === undefined) throw new Error("缺少 ask_user 工具");
    const params = {
      prompt: "  选择处理范围  ",
      description: "  选择最符合本次任务的范围  ",
      options: [
        { id: " focused ", label: " 局部处理 " },
        { id: "complete", label: "完整处理" },
        { id: "review", label: "先复核范围" },
      ],
    };

    validateToolArguments(tool, tool_call(params));
    const result = (await tool.execute(
      "question-1",
      params,
      undefined,
      undefined,
      undefined as never,
    )) as QuestionToolResult;

    expect(wait_for_answer).toHaveBeenCalledWith(
      "question-1",
      {
        prompt: "选择处理范围",
        description: "选择最符合本次任务的范围",
        options: [
          { id: "focused", label: "局部处理" },
          { id: "complete", label: "完整处理" },
          { id: "review", label: "先复核范围" },
        ],
      },
      undefined,
    );
    expect(result.details).toEqual({
      outcome: "selected",
      optionId: "focused",
    });
  });

  it("只接受二至三个固定选项并校验内容", async () => {
    const tool = create_agent_question_tools({ wait_for_answer: vi.fn() })[0];
    if (tool === undefined) throw new Error("缺少 ask_user 工具");
    expect(() => validateToolArguments(tool, tool_call({ prompt: "问题", options: [] }))).toThrow();
    expect(() =>
      validateToolArguments(
        tool,
        tool_call({ prompt: "问题", options: [{ id: "only", label: "唯一选项" }] }),
      ),
    ).toThrow();
    expect(() =>
      validateToolArguments(
        tool,
        tool_call({
          prompt: "问题",
          options: Array.from({ length: 4 }, (_, index) => ({
            id: `option-${index}`,
            label: `选项 ${index + 1}`,
          })),
        }),
      ),
    ).toThrow();
    expect(() =>
      validateToolArguments(
        tool,
        tool_call({
          prompt: "问题",
          options: [
            { id: "safe", label: "安全处理", description: "选项说明" },
            { id: "complete", label: "完整处理" },
          ],
        }),
      ),
    ).toThrow();
    await expect(
      tool.execute(
        "question-1",
        {
          prompt: "问题",
          options: [
            { id: "same", label: "选项一" },
            { id: "same", label: "选项二" },
          ],
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow('"code":"invalid_question"');
    await expect(
      tool.execute(
        "question-2",
        {
          prompt: "问题",
          description: "  ",
          options: [
            { id: "safe", label: "安全处理" },
            { id: "complete", label: "完整处理" },
          ],
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow('"code":"invalid_question"');
  });
});

function tool_call(args: unknown): ToolCall {
  return { type: "toolCall", id: "question", name: "ask_user", arguments: args } as ToolCall;
}
