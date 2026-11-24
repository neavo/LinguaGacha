import type { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_laboratory_page = {
  title: "実験室",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool オプティマイザー",
      description:
        "MTool のテキスト翻訳で、<emphasis>翻訳時間と Token 消費を最大 40% 削減できます</emphasis>。既定で有効です。",
    },
    skip_duplicate_source_text_enable: {
      title: "重複する原文をスキップ",
      description:
        "プロジェクト全体でテキストが同じ項目は一度だけ翻訳し、<emphasis>訳文を再利用</emphasis>します。既定で有効です。",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
