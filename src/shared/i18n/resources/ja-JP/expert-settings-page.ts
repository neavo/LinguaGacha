import type { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_expert_settings_page = {
  title: "エキスパート設定",
  fields: {
    preceding_lines_threshold: {
      title: "参照する前文の最大行数",
      description: "各翻訳タスクに添付できる前文の最大行数です。既定では無効です",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid: "前文の最大行数には有効な範囲の数値を入力してください …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
