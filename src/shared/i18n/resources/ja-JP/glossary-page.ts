import type { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_glossary_page = {
  title: "用語集",
  toggle: {
    tooltip:
      "プロンプトに用語集を組み込み、訳語の統一や人物属性の修正など、モデルの翻訳を補助します",
  },
  fields: {
    translation: "訳文",
    description: "説明",
  },
  feedback: {
    load_failed: "用語集を読み込めませんでした。しばらくしてから再試行してください …",
    query_failed: "用語集を検索できませんでした",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
