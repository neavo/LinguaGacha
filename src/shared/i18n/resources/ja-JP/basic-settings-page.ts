import type { zh_cn_basic_settings_page } from "../zh-CN/basic-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_basic_settings_page = {
  title: "基本設定",
  fields: {
    source_language: {
      title: "原文の言語",
      description: "現在のプロジェクトの入力テキストの言語を設定します",
    },
    target_language: {
      title: "訳文の言語",
      description: "現在のプロジェクトの出力テキストの言語を設定します",
    },
    project_save_mode: {
      title: "プロジェクトファイルの保存先",
      description: "新しいプロジェクトのファイル保存先を設定します",
      description_fixed: "新しいプロジェクトのファイル保存先を設定します" + "\n" + "現在：{PATH}",
      options: {
        manual: "毎回選択",
        fixed: "固定フォルダー",
        source: "元ファイルと同じフォルダー",
      },
    },
    output_folder_open_on_finish: {
      title: "訳文ファイルの生成後に出力フォルダーを開く",
      description: "訳文ファイルを生成できたときに、出力フォルダーを自動で開きます",
    },
    request_timeout: {
      title: "リクエストのタイムアウト",
      description:
        "モデルの応答を待つ最長時間（秒）です。時間内に応答がない場合、タスクは失敗となります",
    },
  },
  feedback: {
    refresh_failed: "基本設定を更新できません。しばらくしてから再試行してください。",
    update_failed: "設定を保存できませんでした。しばらくしてから再試行してください。",
    request_timeout_invalid: "タイムアウトには有効な範囲の数値を入力してください。",
    pick_directory_failed: "フォルダーを選択できませんでした。固定の保存先を選び直してください。",
    source_language_loading_toast: "プロジェクトのキャッシュを更新中 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>;
