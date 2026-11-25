import type { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_batch_translation = {
  menu: {
    progress: "進捗",
    tooltip: "原文を指定した言語に翻訳します",
  },
  summary: {
    translation: { running: "一括翻訳中", stopping: "一括翻訳を停止中" },
    request: { running: "一括リクエスト中", stopping: "一括リクエストを停止中" },
    mixed: { running: "一括タスクを実行中", stopping: "一括タスクを停止中" },
    empty: "タスクなし",
    stopping: "停止処理中",
    detail_tooltip: "クリックして詳細を表示",
  },
  detail: {
    waveform_title: "現在の速度",
    provider: "接続先",
    custom_thinking: "カスタム",
    elapsed_time: "経過時間",
    remaining_time: "残り時間",
    average_speed: "平均速度",
    input_tokens: "入力 Token",
    reasoning_tokens: "思考 Token",
    output_tokens: "出力 Token",
    active_requests: "実行中のタスク数",
  },
  feedback: {
    stats_refresh_failed: "プロジェクトの翻訳統計を更新できませんでした …",
    done: "翻訳が完了しました …",
    stopped: "翻訳を停止しました …",
    ended: "翻訳が終了しました …",
    retry_exhausted: "{count} 件の項目は再試行を繰り返しても成功しなかったため、スキップしました …",
    keys_retry_wait: "API エラー。{seconds} 秒後に自動で再試行します。再試行済み {count} 回 …",
    keys_retry_running: "API エラー。再試行中 …",
    start_failed: "翻訳タスクを開始できませんでした …",
    stop_failed: "一括タスクを停止できませんでした …",
    reset_all_failed: "すべての翻訳をリセットできませんでした …",
  },
  confirm: {
    reset_all_description: "プロジェクト全体の翻訳進捗をリセットしますか …?",
    stop_description: "現在の一括タスクを停止しますか …?",
  },
  action: { stop: "停止" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
