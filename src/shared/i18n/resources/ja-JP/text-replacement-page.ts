import type { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_text_replacement_page = {
  title: "テキスト置換",
  fields: {
    replacement: "置換",

    hit: "一致",
  },
  rule: {
    regex: "正規表現",
    case_sensitive: "大文字・小文字を区別",
  },
  filter: {
    scope: {
      tooltip_label: "検索範囲",
    },
  },

  hit: {
    subset_relations: "包含関係：",

    action: {
      search_relation: "包含関係を検索",
    },
  },

  feedback: {
    load_failed: "置換ルールを読み込めませんでした。しばらくしてから再試行してください。",
    save_failed: "置換ページのデータを保存できませんでした",
    import_failed: "置換ページにインポートできませんでした",

    export_failed: "置換ページからエクスポートできませんでした",

    preset_failed: "置換ページのプリセットを読み込めませんでした",

    query_failed: "置換ページで検索できませんでした",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
