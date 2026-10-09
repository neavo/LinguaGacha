import {
  QualityRule,
  type GlossaryEntry,
  type TextPreserveEntry,
  type TextPreserveMode,
  type TextReplacementEntry,
} from "../../domain/quality";
import { read_json_record, type JsonRecord } from "../../domain/json";
import { normalize_quality_rule_entries } from "./quality-rule-entry";
import { normalize_translation_prompt_slice } from "../../domain/prompt";
import { read_project_revision } from "../../domain/project-revision";

type QualityRuleSnapshot = {
  glossary_enable: boolean;
  text_preserve_mode: TextPreserveMode;
  text_preserve_entries: TextPreserveEntry[];
  pre_replacement_enable: boolean;
  pre_replacement_entries: TextReplacementEntry[];
  post_replacement_enable: boolean;
  post_replacement_entries: TextReplacementEntry[];
  glossary_revision: number;
  text_preserve_revision: number;
  pre_replacement_revision: number;
  post_replacement_revision: number;
  translation_prompt_enable: boolean;
  translation_prompt: string;
  translation_prompt_revision: number;

  glossary_entries: GlossaryEntry[];
};

// 校对算法接收的输入形状；条目由其执行边界解析，项目缓存使用 `QualityRuleBlock` 的明确类型。
export type QualitySlice = {
  entries: Array<Record<string, unknown>>;
  enabled: boolean;
  mode: string;
  revision: number;
};

// 公开规则类型固定为四个切片，消费侧不按物理存储落点取值。
export type QualitySnapshot = {
  glossary: QualitySlice;
  pre_replacement: QualitySlice;
  post_replacement: QualitySlice;
  text_preserve: QualitySlice;
};

/**
 * 质量规则任务快照的唯一解析与序列化入口，统一克隆规则数组和 revision。
 */
export class QualityRuleSnapshotTool {
  /**
   * 从嵌套 quality/prompts payload 恢复任务用快照；缺失字段按质量规则领域默认值归一
   */
  public static from_json(data: unknown): QualityRuleSnapshot {
    const root = read_json_record(data);
    const quality = read_json_record(root["quality"]);
    const prompts = read_json_record(root["prompts"]);
    const glossary = read_json_record(quality["glossary"]);
    const text_preserve = read_json_record(quality["text_preserve"]);
    const pre_replacement = read_json_record(quality["pre_replacement"]);
    const post_replacement = read_json_record(quality["post_replacement"]);
    const translation = normalize_translation_prompt_slice(prompts["translation"]);
    const glossary_rule = QualityRule.from_json("glossary");
    const text_preserve_rule = QualityRule.from_json("text_preserve");
    const pre_replacement_rule = QualityRule.from_json("pre_replacement");
    const post_replacement_rule = QualityRule.from_json("post_replacement");

    return {
      glossary_enable: glossary_rule.normalize_enabled(glossary["enabled"]),
      text_preserve_mode: text_preserve_rule.normalize_mode(text_preserve["mode"]),
      text_preserve_entries: normalize_quality_rule_entries(
        text_preserve_rule,
        text_preserve["entries"] ?? [],
      ),
      pre_replacement_enable: pre_replacement_rule.normalize_enabled(pre_replacement["enabled"]),
      pre_replacement_entries: normalize_quality_rule_entries(
        pre_replacement_rule,
        pre_replacement["entries"] ?? [],
      ),
      post_replacement_enable: post_replacement_rule.normalize_enabled(post_replacement["enabled"]),
      post_replacement_entries: normalize_quality_rule_entries(
        post_replacement_rule,
        post_replacement["entries"] ?? [],
      ),
      glossary_revision: read_project_revision(glossary["revision"]),
      text_preserve_revision: read_project_revision(text_preserve["revision"]),
      pre_replacement_revision: read_project_revision(pre_replacement["revision"]),
      post_replacement_revision: read_project_revision(post_replacement["revision"]),
      translation_prompt_enable: translation.enabled,
      translation_prompt: translation.text,
      translation_prompt_revision: translation.revision,

      glossary_entries: normalize_quality_rule_entries(glossary_rule, glossary["entries"] ?? []),
    };
  }

  /**
   * 输出嵌套快照形状，供 renderer 发起任务、worker 解析与测试对拍共用
   */
  public static to_json(snapshot: QualityRuleSnapshot): JsonRecord {
    return {
      quality: {
        glossary: {
          entries: snapshot.glossary_entries.map((entry) => ({ ...entry })),
          enabled: snapshot.glossary_enable,
          revision: snapshot.glossary_revision,
        },
        text_preserve: {
          entries: snapshot.text_preserve_entries.map((entry) => ({ ...entry })),
          mode: snapshot.text_preserve_mode,
          revision: snapshot.text_preserve_revision,
        },
        pre_replacement: {
          entries: snapshot.pre_replacement_entries.map((entry) => ({ ...entry })),
          enabled: snapshot.pre_replacement_enable,
          revision: snapshot.pre_replacement_revision,
        },
        post_replacement: {
          entries: snapshot.post_replacement_entries.map((entry) => ({ ...entry })),
          enabled: snapshot.post_replacement_enable,
          revision: snapshot.post_replacement_revision,
        },
      },
      prompts: {
        translation: {
          text: snapshot.translation_prompt,
          enabled: snapshot.translation_prompt_enable,
          revision: snapshot.translation_prompt_revision,
        },
      },
    };
  }
}
