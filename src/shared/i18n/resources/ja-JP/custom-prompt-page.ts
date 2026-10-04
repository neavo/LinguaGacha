import type { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_custom_prompt_page = {
  save: {
    discard: "未保存の変更を元に戻す",
    waiting: "タスクが実行中です。後で保存してください …",
  },
  title: "カスタムプロンプト",
  header: {
    description_html: "カスタムプロンプトで物語の設定や文体など、翻訳への追加要件を指定します",
  },
  section: {
    prefix_label: "固定の前置き",
    suffix_label: "固定の後置き",
  },
  confirm: {
    reset: {
      description: "データをリセットしますか …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
