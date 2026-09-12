import type { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_glossary_page = {
  title: "用語集",
  action: {
    preset: "プリセット",
  },
  toggle: {
    tooltip:
      "プロンプトに用語集を組み込み、訳語の統一や人物属性の修正など、モデルの翻訳を補助します",
  },
  fields: {
    translation: "訳文",
    description: "説明",

    hit: "一致",
  },
  hit: {
    action: {
      query_source: "出典を検索",
      search_relation: "包含関係を検索",
    },
  },
  rule: {
    case_sensitive: "大文字・小文字を区別",
  },
  filter: {
    scope: {
      description: "備考",
    },
  },

  feedback: {
    load_failed: "用語集を読み込めませんでした。しばらくしてから再試行してください。",
    save_failed: "用語集を保存できませんでした",
    import_failed: "用語集をインポートできませんでした",

    export_failed: "用語集をエクスポートできませんでした",

    preset_failed: "用語集のプリセットを読み込めませんでした",

    query_failed: "用語集を検索できませんでした",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
