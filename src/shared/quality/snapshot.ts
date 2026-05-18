import {
  QualityRule,
  normalize_text_preserve_mode,
  type TextPreserveMode,
} from "../../base/quality";
import type { JsonRecord } from "../utils/json-tool";

export type QualityRuleSnapshot = {
  glossary_enable: boolean;
  text_preserve_mode: TextPreserveMode;
  text_preserve_entries: JsonRecord[];
  pre_replacement_enable: boolean;
  pre_replacement_entries: JsonRecord[];
  post_replacement_enable: boolean;
  post_replacement_entries: JsonRecord[];
  glossary_revision: number;
  text_preserve_revision: number;
  pre_replacement_revision: number;
  post_replacement_revision: number;
  translation_prompt_enable: boolean;
  translation_prompt: string;
  translation_prompt_revision: number;
  analysis_prompt_enable: boolean;
  analysis_prompt: string;
  analysis_prompt_revision: number;
  glossary_entries: JsonRecord[];
};

export const QUALITY_RULE_REVISION_META_KEY_PREFIX = "quality_rule_revision";
export const QUALITY_PROMPT_REVISION_META_KEY_PREFIX = "quality_prompt_revision";

export class QualityRuleSnapshotTool {
  /**
   * 统一复制有效规则项，避免不同规则各写一套筛选逻辑
   */
  public static copy_non_empty_entries(raw_entries: unknown): JsonRecord[] {
    return this.normalize_entries(raw_entries).flatMap((entry) => {
      return String(entry["src"] ?? "").trim() === "" ? [] : [{ ...entry }];
    });
  }

  /**
   * 只保留普通对象项，数组、null 和标量不能进入快照
   */
  public static normalize_entries(raw_entries: unknown): JsonRecord[] {
    if (!Array.isArray(raw_entries)) {
      return [];
    }
    return raw_entries.flatMap((entry) => (is_record(entry) ? [{ ...entry }] : []));
  }

  public static normalize_text_preserve_mode(value: unknown): TextPreserveMode {
    return normalize_text_preserve_mode(value);
  }

  public static normalize_revision(value: unknown): number {
    let revision = 0;
    if (typeof value === "number") {
      revision = Number.isFinite(value) ? Math.trunc(value) : 0;
    } else if (typeof value === "bigint") {
      revision = Number(value);
    } else if (typeof value === "boolean") {
      revision = value ? 1 : 0;
    } else if (typeof value === "string" && /^[-+]?\d+$/u.test(value.trim())) {
      revision = Number.parseInt(value.trim(), 10);
    }
    return Math.max(0, Number.isFinite(revision) ? revision : 0);
  }

  public static build_rule_revision_meta_key(rule_type: string): string {
    return `${QUALITY_RULE_REVISION_META_KEY_PREFIX}.${rule_type}`;
  }

  public static build_prompt_revision_meta_key(task_type: string): string {
    return `${QUALITY_PROMPT_REVISION_META_KEY_PREFIX}.${task_type}`;
  }

  /**
   * 从嵌套 quality/prompts payload 恢复任务用快照；缺失字段按质量规则领域默认值归一
   */
  public static from_json(data: unknown): QualityRuleSnapshot {
    const root = read_record(data);
    const quality = read_record(root["quality"]);
    const prompts = read_record(root["prompts"]);
    const glossary = read_record(quality["glossary"]);
    const text_preserve = read_record(quality["text_preserve"]);
    const pre_replacement = read_record(quality["pre_replacement"]);
    const post_replacement = read_record(quality["post_replacement"]);
    const translation = read_record(prompts["translation"]);
    const analysis = read_record(prompts["analysis"]);
    const glossary_entries = this.normalize_entries(glossary["entries"]);
    const glossary_rule = QualityRule.from_json("glossary");
    const text_preserve_rule = QualityRule.from_json("text_preserve");
    const pre_replacement_rule = QualityRule.from_json("pre_replacement");
    const post_replacement_rule = QualityRule.from_json("post_replacement");

    return {
      glossary_enable: glossary_rule.normalize_enabled(glossary["enabled"]),
      text_preserve_mode: text_preserve_rule.normalize_mode(text_preserve["mode"]),
      text_preserve_entries: this.copy_non_empty_entries(text_preserve["entries"]),
      pre_replacement_enable: pre_replacement_rule.normalize_enabled(pre_replacement["enabled"]),
      pre_replacement_entries: this.copy_non_empty_entries(pre_replacement["entries"]),
      post_replacement_enable: post_replacement_rule.normalize_enabled(post_replacement["enabled"]),
      post_replacement_entries: this.copy_non_empty_entries(post_replacement["entries"]),
      glossary_revision: this.normalize_revision(glossary["revision"] ?? 0),
      text_preserve_revision: this.normalize_revision(text_preserve["revision"] ?? 0),
      pre_replacement_revision: this.normalize_revision(pre_replacement["revision"] ?? 0),
      post_replacement_revision: this.normalize_revision(post_replacement["revision"] ?? 0),
      translation_prompt_enable: Boolean(translation["enabled"] ?? false),
      translation_prompt: String(translation["text"] ?? ""),
      translation_prompt_revision: this.normalize_revision(translation["revision"] ?? 0),
      analysis_prompt_enable: Boolean(analysis["enabled"] ?? false),
      analysis_prompt: String(analysis["text"] ?? ""),
      analysis_prompt_revision: this.normalize_revision(analysis["revision"] ?? 0),
      glossary_entries: this.copy_non_empty_entries(glossary_entries),
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
        analysis: {
          text: snapshot.analysis_prompt,
          enabled: snapshot.analysis_prompt_enable,
          revision: snapshot.analysis_prompt_revision,
        },
      },
    };
  }

  /**
   * 返回术语表条目的不可变副本，避免任务执行期被 UI 后续编辑影响
   */
  public static get_glossary_entries(snapshot: QualityRuleSnapshot): JsonRecord[] {
    return snapshot.glossary_entries.map((entry) => ({ ...entry }));
  }
}

function read_record(value: unknown): JsonRecord {
  return is_record(value) ? { ...value } : {};
}

function is_record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
