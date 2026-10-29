import { zh_cn_translation_transfer_page } from "../zh-CN/translation-transfer-page";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_translation_transfer_page = {
  title: "訳文移行",
  fields: {
    source: { title: "移行元プロジェクト" },
    base: { title: "移行先プロジェクト" },
    mode: {
      title: "移行モード",
      fill: "補完",
      overwrite: "上書き",
      fill_description: "競合時は移行先プロジェクトの訳文を優先して残します",
      overwrite_description: "競合時は移行元プロジェクトの訳文を優先して使用します",
    },
  },
  action: { start: "新しいプロジェクトを生成" },
  feedback: {
    result: "補完 {FILLED} 件 · 置換 {REPLACED} 件 · 未一致 {UNMATCHED} 件",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_transfer_page>;
