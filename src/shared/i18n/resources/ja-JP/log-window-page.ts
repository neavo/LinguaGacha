import type { zh_cn_log_window_page } from "../zh-CN/log-window-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_log_window_page = {
  title: "ログ",
  level: {
    all: "すべて",
    debug: "デバッグ",
    info: "情報",
    warning: "警告",
    error: "エラー",
    fatal: "致命的",
  },
  fields: {
    time: "時刻",
    message: "メッセージ",
  },
  action: {
    return_to_top: "先頭に戻る",
  },
  search: {
    placeholder: "検索 …",
    clear: "クリア",
    regex: "正規表現",
    regex_tooltip_label: "正規表現モード",
    regex_invalid: "正規表現が無効です。",
    scope: {
      label: "範囲",
      tooltip_label: "ログの範囲",
    },
  },
  detail: {
    title: "詳細",
    previous: "前へ",
    next: "次へ",
    maximize: "最大化",
    minimize: "最小化",
    empty: "ログを選択すると詳細が表示されます。",
    loading: "ログの詳細を読み込み中 …",
    unavailable:
      "ログの詳細は現在のプロセスのメモリから解放されています。ログファイルを確認してください。",
    failed: "ログの詳細を読み込めませんでした。",
    content: {
      source_text: "原文",
      translated_text: "訳文",
      source_term: "原語",
      translated_term: "訳語",
      term_info: "備考",
      error: "エラーの詳細",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;
