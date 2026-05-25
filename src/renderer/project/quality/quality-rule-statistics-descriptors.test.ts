import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "@base/item";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import type { ProjectStoreState } from "@/project/store/project-store";
import {
  buildQualityRuleStatisticsRuleDescriptors,
  prepareQualityRuleStatisticsRuleContext,
} from "@/project/quality/quality-rule-statistics-descriptors";

// create_test_item 构造统计描述符测试需要的最小项目条目。
function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

// create_test_state 提供四类质量规则与源/译文文本，用于验证描述符分流。
function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/demo.lg",
      loaded: true,
    },
    files: {},
    items: createProjectItemIndex({
      "1": create_test_item({
        item_id: 1,
        src: "苹果很好吃",
        dst: "Apple is tasty",
      }),
    }),
    quality: {
      glossary: {
        entries: [
          {
            entry_id: "glossary-1",
            src: "苹果",
            dst: "Apple",
            info: "",
            case_sensitive: true,
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
      pre_replacement: {
        entries: [
          {
            entry_id: "pre-1",
            src: "林檎",
            dst: "苹果",
            regex: false,
            case_sensitive: false,
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
      post_replacement: {
        entries: [
          {
            entry_id: "post-1",
            src: "Apple",
            dst: "Pomme",
            regex: true,
            case_sensitive: true,
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
      text_preserve: {
        entries: [
          {
            entry_id: "preserve-1",
            src: "HP",
            dst: "",
            info: "",
          },
          {
            entry_id: "blank",
            src: " ",
            dst: "",
            info: "",
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
    },
    prompts: {
      translation: {
        text: "",
        enabled: false,
        revision: 0,
      },
      analysis: {
        text: "",
        enabled: false,
        revision: 0,
      },
    },
    analysis: {},
    proofreading: {
      revision: 0,
    },
    revisions: {
      projectRevision: 1,
      sections: {
        items: 1,
        quality: 1,
      },
    },
  };
}

describe("quality rule statistics descriptors", () => {
  it("按规则类型生成 worker 可消费的统计规则", () => {
    const state = create_test_state();

    expect(buildQualityRuleStatisticsRuleDescriptors(state, "glossary")).toMatchObject([
      {
        key: "glossary-1",
        relation_label: "苹果",
        rule: {
          mode: "glossary",
          pattern: "苹果",
          case_sensitive: true,
        },
      },
    ]);
    expect(buildQualityRuleStatisticsRuleDescriptors(state, "post_replacement")).toMatchObject([
      {
        key: "post-1",
        relation_label: "Apple",
        rule: {
          mode: "post_replacement",
          pattern: "Apple",
          regex: true,
          case_sensitive: true,
        },
      },
    ]);
  });

  it("文本保护会跳过空规则并固定为正则统计", () => {
    const descriptors = buildQualityRuleStatisticsRuleDescriptors(
      create_test_state(),
      "text_preserve",
    );

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({
      key: "preserve-1",
      rule: {
        mode: "text_preserve",
        pattern: "HP",
        regex: true,
        case_sensitive: false,
      },
    });
  });

  it("后置替换统计使用译文文本，其它规则使用源文文本", () => {
    const state = create_test_state();

    expect(
      prepareQualityRuleStatisticsRuleContext(
        state,
        "post_replacement",
      ).current_statistics_context.snapshot.text_source,
    ).toBe("dst");
    expect(
      prepareQualityRuleStatisticsRuleContext(
        state,
        "glossary",
      ).current_statistics_context.snapshot.text_source,
    ).toBe("src");
  });
});
