import { describe, expect, it } from "vitest";

import { normalize_model_selection_snapshot } from "./model-selection";

describe("模型选择快照", () => {
  it("只保留合法用途和窄模型选项", () => {
    expect(
      normalize_model_selection_snapshot({
        model_selection: {
          translation: " translation-model ",
          analysis: 7,
          agent: "agent-model",
          unknown: "ignored",
        },
        models: [
          {
            id: " model-1 ",
            type: "PRESET",
            name: " 预设 ",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
            thinking_level: "HIGH",
            available_thinking_levels: ["LOW", "HIGH", "UNKNOWN"],
          },
          {
            id: "model-2",
            type: "UNKNOWN",
            name: "坏类型",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
          },
          {
            id: "",
            type: "CUSTOM_OPENAI",
            name: "空 ID",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
          },
          { id: "missing-agent-limits", type: "CUSTOM_OPENAI", name: "缺少容量" },
          null,
        ],
      }),
    ).toEqual({
      model_selection: {
        translation: "translation-model",
        analysis: "",
        agent: "agent-model",
      },
      models: [
        {
          id: "model-1",
          type: "PRESET",
          name: "预设",
          agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
          thinking_level: "HIGH",
          available_thinking_levels: ["LOW", "HIGH"],
        },
      ],
    });
  });

  it("非法思考字段回退安全默认值", () => {
    const snapshot = normalize_model_selection_snapshot({
      models: [
        {
          id: "model-1",
          type: "PRESET",
          name: "预设",
          agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
          thinking_level: "UNKNOWN",
          available_thinking_levels: "HIGH",
        },
      ],
    });

    expect(snapshot.models[0]).toMatchObject({
      thinking_level: "OFF",
      available_thinking_levels: [],
    });
  });
});
