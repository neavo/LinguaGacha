import { expect, it } from "vitest";
import type { ModelThinkingLevel } from "@domain/model";
import { order_model_thinking_levels } from "./model-selection-meta";

it("保持默认移到末尾，保留其余等级顺序和原始能力列表", () => {
  const levels: readonly ModelThinkingLevel[] = Object.freeze(["HIGH", "DEFAULT", "LOW"]);
  expect(order_model_thinking_levels(levels)).toEqual(["HIGH", "LOW", "DEFAULT"]);
});
