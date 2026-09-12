import type { zh_cn_text_preserve_page } from "../zh-CN/text-preserve-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_text_preserve_page = {
  title: "テキスト保護",

  mode: {
    label: "テキスト保護モード",

    loading_toast: "校正キャッシュを更新中 …",
    content_html:
      "翻訳不要なコード、制御文字、装飾文字などを保護し、誤って翻訳されるのを防ぎます" +
      "<br>" +
      "• オフ - 保護ルールを使わず、判断と処理を AI に任せます" +
      "<br>" +
      "• スマート - テキスト形式とゲームエンジンを判別し、適切な保護ルールを自動で選びます" +
      "<br>" +
      "• カスタム - このページで設定した <font color='darkgoldenrod'><b>正規表現ルール</b></font> に一致するテキストを保護します",
    options: {
      off: "オフ",
      smart: "スマート",
      custom: "カスタム",
    },
  },
  fields: {
    note: "備考（メモ専用、動作への影響なし）",
    hit: "一致",
  },
  filter: {
    scope: {
      rule: "ルール",
      note: "備考",
    },
  },

  preset: {
    dialog: {
      name_placeholder: "プリセット名を入力 …",
    },
  },
  hit: {
    hit_count: "一致する項目数：{COUNT}",
  },

  feedback: {
    load_failed: "テキスト保護ルールを読み込めませんでした。しばらくしてから再試行してください。",
    preset_name_required: "プリセット名を入力してください",

    unknown_error: "操作に失敗しました。しばらくしてから再試行してください。",

    mode_refresh_pending:
      "テキスト保護モードを切り替えました。校正キャッシュの更新後に結果を確認してください。",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_preserve_page>;
