import type { zh_cn_quality_rule_editor } from "../zh-CN/quality-rule-editor";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_quality_rule_editor = {
  confirm: {
    delete_selection: {
      description: "{COUNT} 件のレコードを削除しますか …?",
    },
    reset: {
      description: "データをリセットしますか …?",
    },
  },
  feedback: {
    regex_invalid: "正規表現が無効です",
    source_required: "原文を入力してください",
    save_failed: "ルールを保存できませんでした",
    update_failed: "ルールの設定を保存できませんでした",
    import_failed: "ルールをインポートできませんでした",
    export_failed: "ルールをエクスポートできませんでした",
  },
  fields: {
    rule: "ルール",
    source: "原文",
    hit: "一致",
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
  hit: {
    hit_count: "一致する項目数：{COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "包含関係：",
    query_source: "出典を検索",
    search_relation: "包含関係を検索",
  },
  rule: { case_sensitive: "大文字・小文字を区別" },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_rule_editor>;
