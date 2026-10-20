import type { zh_cn_basic_settings_page } from "../zh-CN/basic-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_basic_settings_page = {
  title: "基本設定",
  fields: {
    source_language: {
      description: "入力テキストの言語を設定します",
    },
    target_language: {
      description: "出力テキストの言語を設定します",
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
    proxy: {
      title: "送信プロキシ",
      description: "翻訳、Agent、アプリ更新の通信リクエストに適用されます",
      protocol_label: "プロトコル",
      server_label: "プロキシサーバー",
      address_label: "アドレス",
      port_label: "ポート",
      host_placeholder: "proxy.example.com",
      server_description:
        "ホスト名または IP のみを入力し、http:// やポートは含めません。IPv6 は [::1] のように角括弧で囲みます",
      port_placeholder: "ポート",
      auth_label: "認証（任意）",
      username_placeholder: "ユーザー名",
      auth_description:
        "ユーザー名とパスワードは平文でローカルに保存され、このプロキシにのみ使用されます",
      password_placeholder: "パスワード",
      save: "プロキシ設定を保存",
    },
  },
  status: {
    apply_failed: "プロキシ設定を適用できませんでした。システムプロキシで送信します：{REASON}",
    manual_incomplete: "手動プロキシの設定が不完全または無効なため、システムプロキシで送信します",
    socks5_auth: "SOCKS5 認証はアプリ更新では利用できません。更新はシステムプロキシを使用します",
  },

  feedback: {
    proxy_host_invalid:
      "アドレスは必須です。http://、ポート、空白は含めず、IPv6 は角括弧で囲んでください",
    proxy_port_invalid: "ポートは 1〜65535 の整数で入力してください",
    proxy_username_required: "パスワードを設定する場合はユーザー名も入力してください",
    proxy_saved: "プロキシ設定を保存しました",
    request_timeout_invalid: "タイムアウトには有効な範囲の数値を入力してください …",
    pick_directory_failed: "フォルダーを選択できませんでした。固定の保存先を選び直してください …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>;
