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
          { id: " model-1 ", type: "PRESET", name: " 预设 " },
          { id: "model-2", type: "UNKNOWN", name: "坏类型" },
          { id: "", type: "CUSTOM_OPENAI", name: "空 ID" },
          null,
        ],
      }),
    ).toEqual({
      model_selection: {
        translation: "translation-model",
        analysis: "",
        agent: "agent-model",
      },
      models: [{ id: "model-1", type: "PRESET", name: "预设" }],
    });
  });
});
