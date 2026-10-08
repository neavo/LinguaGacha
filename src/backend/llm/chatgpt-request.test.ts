import { describe, expect, it } from "vitest";
import { apply_chatgpt_payload, observe_chatgpt_request } from "./chatgpt-request";

describe("ChatGPT 请求边界", () => {
  it("工具 namespace、指令角色和生成参数在最终扩展合并后符合契约", () => {
    const result = apply_chatgpt_payload(
      {
        store: false,
        stream: true,
        input: [{ role: "system", content: "guide" }],
        max_output_tokens: 100,
        temperature: 1,
        tools: [{ type: "function", name: "translate", parameters: {} }],
        tool_choice: "auto",
      },
      { reasoning: { effort: "high" } },
    );
    expect(result).toEqual({
      store: false,
      stream: true,
      input: [{ role: "developer", content: "guide" }],
      tools: [
        {
          type: "namespace",
          name: "linguagacha",
          description: expect.stringMatching(/\S/),
          tools: [{ type: "function", name: "translate", parameters: {} }],
        },
      ],
      reasoning: { effort: "high" },
      tool_choice: "auto",
    });
    expect(() => apply_chatgpt_payload(result, { temperature: 0 })).toThrowError(
      expect.objectContaining({ code: "model.provider_failed" }),
    );
    expect(() => apply_chatgpt_payload(result, { store: true })).toThrow();
  });

  it("混合工具只包装 function 与 custom，选择指向本次包装的工具", () => {
    const tools = [
      { type: "function", name: "translate" },
      { type: "custom", name: "format" },
    ];
    const other = [
      {
        type: "namespace",
        name: "external",
        description: "External tools",
        tools: [{ type: "function", name: "translate" }],
      },
      { type: "web_search" },
      { type: "web_search_preview" },
    ];
    const result = apply_chatgpt_payload(
      { store: false, stream: true, input: [], tools: [...tools, ...other] },
      { tool_choice: { type: "custom", name: "format" } },
    );
    expect(result["tools"]).toEqual([
      ...other,
      {
        type: "namespace",
        name: "linguagacha",
        description: expect.stringMatching(/\S/),
        tools,
      },
    ]);
    expect(result["tool_choice"]).toEqual({
      type: "custom",
      name: "format",
      namespace: "linguagacha",
    });
  });

  it.each([
    { type: "function", name: "other" },
    { type: "custom", name: "translate" },
    { type: "function", name: "translate", namespace: "external" },
  ])("只在类型和名称匹配且未指定 namespace 时补全选择 %j", (tool_choice) => {
    expect(
      apply_chatgpt_payload(
        {
          store: false,
          stream: true,
          input: [],
          tools: [{ type: "function", name: "translate" }],
          tool_choice,
        },
        {},
      )["tool_choice"],
    ).toEqual(tool_choice);
  });

  it("没有顶层函数时保留追加声明和工具选择", () => {
    const payload = {
      store: false,
      stream: true,
      input: [
        {
          type: "additional_tools",
          tools: [{ type: "function", name: "translate", parameters: {} }],
        },
      ],
      tools: [{ type: "web_search" }],
      tool_choice: { type: "function", name: "translate" },
    };
    expect(apply_chatgpt_payload(payload, {})).toEqual(payload);
  });

  it.each([null, { type: "file_search" }])("拒绝不受支持的工具 %j", (tool) => {
    expect(() =>
      apply_chatgpt_payload({ store: false, stream: true, input: [], tools: [tool] }, {}),
    ).toThrowError(
      expect.objectContaining({
        code: "model.provider_failed",
        diagnostic_context: expect.objectContaining({ retryable: false }),
      }),
    );
  });

  it("HTTP 200 后的 SSE 额度错误仍不可重试，临时可用性错误保留重试资格", async () => {
    const observation = observe_chatgpt_request();
    await observation.options.onProviderStreamEvent?.(
      {
        type: "response.failed",
        response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
      },
      {} as never,
    );
    expect(observation.failure()).toMatchObject({ retryable: false });
    await observation.options.onProviderStreamEvent?.(
      {
        type: "response.failed",
        response: { error: { code: "subscription_sharing_usage_unavailable" } },
      },
      {} as never,
    );
    expect(observation.failure()).toMatchObject({ retryable: true });
  });
});
