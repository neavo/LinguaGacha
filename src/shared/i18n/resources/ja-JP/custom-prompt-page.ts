import type { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_custom_prompt_page = {
  save: {
    discard: "未保存の変更を元に戻す",
    waiting: "タスクが実行中です。後で保存してください。",
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
      description: "データをリセットしますか？",
    },
  },
  feedback: {
    load_failed: "プロンプトを読み込めませんでした。再試行してください。",
    save_failed: "プロンプトを保存できませんでした。編集内容は保持されています。",
    import_failed: "タスクの実行に失敗しました …",
    export_failed: "タスクの実行に失敗しました …",
    preset_failed: "タスクの実行に失敗しました …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
