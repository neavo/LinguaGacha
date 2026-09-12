import type { zh_cn_quality_rule_editor } from "../zh-CN/quality-rule-editor";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_quality_rule_editor = {
  confirm: {
    delete_selection: {
      description: "{COUNT} 件のレコードを削除しますか？",
    },
    reset: {
      description: "データをリセットしますか？",
    },
  },
  feedback: {
    regex_invalid: "正規表現が無効です",
    source_required: "原文を入力してください",
  },
  fields: {
    rule: "ルール",
    source: "原文",
  },
  filter: {
    clear: "クリア",
    placeholder: "検索 …",
    regex: "正規表現",
    regex_tooltip_label: "正規表現モード",
    scope: {
      all: "すべて",
      label: "範囲",
      tooltip_label: "検索範囲",
    },
  },
  sort: {
    ascending: "昇順",
    clear: "キャンセル",
    descending: "降順",
  },
  hit: {
    hit_count: "一致する項目数：{COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "包含関係：",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_rule_editor>;
