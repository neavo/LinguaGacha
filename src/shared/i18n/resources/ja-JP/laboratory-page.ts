import type { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_laboratory_page = {
  title: "実験室",
  fields: {
    agent_batch_translation_thinking_adaptive_enable: {
      title: "思考レベル自動調整",
      description:
        "翻訳タスクで深い思考を行うと、Token 消費量が <emphasis>3～5 倍になります</emphasis>" +
        "\n" +
        "有効にすると、翻訳タスクの思考レベルを賢く調整し、Token 効率を高め、時間と費用を節約します。既定で有効です",
    },
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
        "同一ファイル内の原文が同じ項目は一度だけ翻訳し、<emphasis>訳文を再利用</emphasis>します。既定で有効です。",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
