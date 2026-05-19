import { describe, expect, it } from "vitest";

import {
  build_section_revisions_from_meta,
  get_runtime_section_revision,
} from "./project-section-revision";

describe("project-section-revision", () => {
  it("从 meta 归一项目数据 section revision 并过滤坏值", () => {
    const meta = {
      "project_runtime_revision.files": -1,
      "project_runtime_revision.items": "9.7",
      "project_runtime_revision.analysis": 4,
      "proofreading_revision.proofreading": "6.2",
      "quality_rule_revision.glossary": 2,
      "quality_rule_revision.text_preserve": "5.9",
      "quality_rule_revision.pre_replacement": "坏值",
      "quality_rule_revision.post_replacement": 3,
      "quality_prompt_revision.translation": "8.8",
      "quality_prompt_revision.analysis": Number.NaN,
    };

    expect(get_runtime_section_revision(meta, "files")).toBe(0);
    expect(get_runtime_section_revision(meta, "items")).toBe(9);
    expect(get_runtime_section_revision(meta, "analysis")).toBe(4);
    expect(get_runtime_section_revision(meta, "proofreading")).toBe(6);
    expect(get_runtime_section_revision(meta, "quality:glossary")).toBe(2);
    expect(get_runtime_section_revision(meta, "quality")).toBe(5);
    expect(get_runtime_section_revision(meta, "prompts:translation")).toBe(8);
    expect(get_runtime_section_revision(meta, "prompts")).toBe(8);
    expect(get_runtime_section_revision(meta, "unknown")).toBe(0);
  });

  it("构建完整 section revision 快照", () => {
    const meta = {
      "project_runtime_revision.files": 3,
      "project_runtime_revision.items": 9,
      "project_runtime_revision.analysis": 4,
      "proofreading_revision.proofreading": 6,
      "quality_rule_revision.glossary": 2,
      "quality_prompt_revision.translation": 8,
    };

    expect(build_section_revisions_from_meta(meta)).toEqual({
      project: 0,
      files: 3,
      items: 9,
      quality: 2,
      prompts: 8,
      analysis: 4,
      proofreading: 6,
    });
  });
});
