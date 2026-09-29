import type { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_text_replacement_page = {
  title: "テキスト置換",
  fields: {
    replacement: "置換",
  },
  rule: {
    regex: "正規表現",
  },
  feedback: {
    load_failed: "置換ルールを読み込めませんでした。しばらくしてから再試行してください …",
    query_failed: "置換ページで検索できませんでした",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
