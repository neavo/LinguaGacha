import { describe, expect, it } from "vitest";

import {
  build_project_quality_rule_input,
  resolve_project_prompt_storage,
  resolve_project_quality_rule_storage,
} from "./project-task-input";
import { QualityRule } from "../../domain/quality";

describe("project-task-input", () => {
  it("按规则类型构造唯一项目输入形状", () => {
    expect(
      build_project_quality_rule_input(
        QualityRule.from_json("text_preserve"),
        [{ entry_id: "tag", src: "<[^>]+>", info: "" }],
        true,
      ),
    ).toEqual({
      kind: "text_preserve",
      entries: [{ entry_id: "tag", src: "<[^>]+>", info: "" }],
      enabled: null,
      mode: "custom",
    });
    expect(build_project_quality_rule_input(QualityRule.from_json("glossary"), [], false)).toEqual({
      kind: "glossary",
      entries: [],
      enabled: false,
      mode: null,
    });
  });

  it("质量规则映射到唯一物理存储键", () => {
    expect(resolve_project_quality_rule_storage("glossary")).toEqual({
      database_type: "glossary",
      enabled_meta_key: "glossary_enable",
      mode_meta_key: null,
      revision_meta_key: "quality_rule_revision.glossary",
    });
    expect(resolve_project_quality_rule_storage("text_preserve")).toEqual({
      database_type: "text_preserve",
      enabled_meta_key: null,
      mode_meta_key: "text_preserve_mode",
      revision_meta_key: "quality_rule_revision.text_preserve",
    });
  });

  it("提示词映射到唯一物理存储键", () => {
    expect(resolve_project_prompt_storage("translation")).toEqual({
      database_type: "translation_prompt",
      enabled_meta_key: "translation_prompt_enable",
      revision_meta_key: "quality_prompt_revision.translation",
    });
    expect(resolve_project_prompt_storage("analysis")).toEqual({
      database_type: "analysis_prompt",
      enabled_meta_key: "analysis_prompt_enable",
      revision_meta_key: "quality_prompt_revision.analysis",
    });
  });
});
