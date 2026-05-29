import { describe, expect, it } from "vitest";

import { TranslationTaskDefinition } from "./translation-task-definition";

describe("TranslationTaskDefinition", () => {
  it("普通翻译只校验质量规则和提示词 revision", () => {
    const definition = new TranslationTaskDefinition();

    expect(
      definition.revision_dependencies({
        task_type: "translation",
        mode: "new",
        scope: { kind: "all" },
        expected_section_revisions: {},
      }),
    ).toEqual(["quality", "prompts"]);
  });

  it("重翻行级 scope 会额外校验 items 和 proofreading revision", () => {
    const definition = new TranslationTaskDefinition();

    expect(
      definition.revision_dependencies({
        task_type: "translation",
        mode: "continue",
        scope: { kind: "items", item_ids: [1, 2] },
        expected_section_revisions: {},
      }),
    ).toEqual(["items", "proofreading", "quality", "prompts"]);
  });

  it("构造计划时固定 translation 任务边界", () => {
    const definition = new TranslationTaskDefinition();

    expect(
      definition.prepare_plan({
        task_type: "translation",
        mode: "reset",
        scope: { kind: "all" },
        expected_section_revisions: {},
      }),
    ).toEqual({
      task_type: "translation",
      progress: {},
      units: [],
    });
  });
});
