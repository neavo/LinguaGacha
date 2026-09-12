import type { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_batch_translation = {
  menu: {
    progress: "進捗",
    tooltip: "原文を指定した言語に翻訳します",
  },
  summary: {
    empty: "タスクなし",
    stopping: "停止処理中",
    detail_tooltip: "クリックして詳細を表示",
    running: "翻訳中",
  },
  detail: {
    provider: "接続先",
    elapsed_time: "経過時間",
    remaining_time: "残り時間",
    average_speed: "平均速度",
    input_tokens: "入力 Token",
    reasoning_tokens: "思考 Token",
    output_tokens: "出力 Token",
    waveform_title: "現在の速度",
    metrics_title: "統計",

    active_requests: "実行中のタスク数",
  },
  feedback: {
    done: "完了 …",
    stopped: "停止済み …",
    refresh_failed: "翻訳タスクの状態を更新できませんでした",
    start_failed: "翻訳タスクを開始できませんでした",
    stop_failed: "翻訳タスクを停止できませんでした",
    reset_all_failed: "すべての翻訳をリセットできませんでした",
    reset_failed_failed: "失敗した項目をリセットできませんでした",
  },
  confirm: {
    reset_all_description: "プロジェクト全体の翻訳進捗をリセットしますか？",
    reset_failed_description: "翻訳に失敗した項目をリセットしますか？",
    generate_description: "現在利用できる訳文を出力しますか？",
    stop_description: "現在の翻訳タスクを停止しますか？",
  },
  action: { stop: "停止" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
