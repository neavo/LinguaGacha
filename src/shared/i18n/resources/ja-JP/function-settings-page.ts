import type { zh_cn_function_settings_page } from "../zh-CN/function-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_function_settings_page = {
  title: "機能設定",
  fields: {
    source_language: {
      description: "入力テキストの言語を設定します",
    },
    target_language: {
      description: "出力テキストの言語を設定します",
    },
    preceding_lines_threshold: {
      title: "参照する前文の項目数",
      description:
        "各タスクに含める参考前文の項目数を設定します。トークン消費量が増えます。既定では無効です。",
    },
    following_lines_threshold: {
      title: "参照する後文の項目数",
      description:
        "各タスクに含める参考後文の項目数を設定します。トークン消費量が増えます。既定では無効です。",
    },
    request_timeout: {
      title: "リクエストのタイムアウト",
      description:
        "モデルの応答を待つ最長時間（秒）です。時間内に応答がない場合、タスクは失敗となります",
    },
    project_save_mode: {
      title: "プロジェクトファイルの保存先",
      description: "新しいプロジェクトを作成するときのプロジェクトファイルの保存先を設定します",
      options: {
        manual: "毎回選択",
        fixed: "固定フォルダー",
        source: "元ファイルと同じフォルダー",
      },
    },
    translation_save_mode: {
      title: "訳文ファイルの保存先",
      description: "訳文を生成するときの訳文ファイルの保存先を設定します",
      options: {
        manual: "毎回選択",
        fixed: "固定フォルダー",
        project: "プロジェクトファイルと同じフォルダー",
      },
    },
    output_folder_open_on_finish: {
      title: "訳文ファイルの生成後に出力フォルダーを開く",
      description: "訳文ファイルを生成できたときに、出力フォルダーを自動で開きます",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "参照する前文の項目数は 0 から 9999999 の整数で入力してください …",
    following_lines_threshold_invalid:
      "参照する後文の項目数は 0 から 9999999 の整数で入力してください …",
    request_timeout_invalid: "タイムアウトには有効な範囲の数値を入力してください …",
    pick_directory_failed: "フォルダーを選択できませんでした。固定の保存先を選び直してください …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_function_settings_page>;
