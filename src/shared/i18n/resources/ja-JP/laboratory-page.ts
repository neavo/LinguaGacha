import type { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_laboratory_page = {
  title: "実験室",
  fields: {
    prompt_enhancement_enable: {
      title: "プロンプト強化",
      description:
        "思考の連鎖を模擬し、AI が指示に従う能力を高めます" +
        "\n" +
        "オフにすると Token 消費がわずかに減りますが、AI のタスク遂行能力が大きく低下します。既定で有効です",
    },
    mtool_optimizer_enable: {
      title: "MTool オプティマイザー",
      description:
        "MTool のテキスト翻訳で、<emphasis>翻訳時間と Token 消費を最大 40% 削減できます</emphasis>。既定で有効です",
    },
    skip_duplicate_source_text_enable: {
      title: "重複する原文をスキップ",
      description:
        "同一ファイルで本文・キャラクター名・テキストルールが同じ項目は一度だけ翻訳し、<emphasis>訳文を再利用</emphasis>します。既定で有効です。",
    },
  },
  feedback: {
    refresh_failed: "実験室の設定を更新できません。しばらくしてから再試行してください …",
    update_failed: "実験室の設定を保存できませんでした。しばらくしてから再試行してください …",
    mtool_optimizer_loading_toast: "プロジェクトのキャッシュを更新中 …",
    skip_duplicate_source_text_loading_toast: "プロジェクトのキャッシュを更新中 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
