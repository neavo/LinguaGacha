import type { zh_cn_model_page } from "../zh-CN/model-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_model_page = {
  title: "モデル管理",
  category: {
    preset: {
      description: "アプリ内蔵のプリセットモデル",
    },
    custom_google: {
      description: "Google Gemini API 形式に対応するカスタムモデル",
    },
    custom_openai: {
      description: "OpenAI API 形式に対応するカスタムモデル",
    },
    custom_openai_responses: {
      description: "OpenAI Responses API 形式に対応するカスタムモデル",
    },
    custom_anthropic: {
      description: "Anthropic Claude API 形式に対応するカスタムモデル",
    },
  },
  action: {
    basic_settings: "基本設定",
    task_settings: "タスク設定",
    advanced_settings: "詳細設定",
    input: "入力",
    fetch: "取得",
    test: "テスト",
  },
  dialog: {
    selector: {
      loading: "モデル一覧を取得中 …",
      search_placeholder: "モデルを絞り込む …",
      empty: "有効なデータがありません …",
    },
  },
  confirm: {
    delete: {
      description: "モデルを削除しますか？",
    },
    reset: {
      description: "モデルをリセットしますか？",
    },
  },
  feedback: {
    refresh_failed: "モデル情報を更新できませんでした。しばらくしてから再試行してください …",
    add_failed: "モデルを追加できませんでした。しばらくしてから再試行してください …",
    update_failed: "モデル設定を保存できませんでした。しばらくしてから再試行してください …",
    reorder_failed: "モデルの順序を保存できませんでした。しばらくしてから再試行してください …",
    delete_last_one: "各カテゴリにはモデルが 1 つ以上必要なため、削除できません …",
    agent_limits_adjusted: "設定値が無効なため、利用できる値に自動調整しました …",
    json_format_error: "JSON の形式が無効です。有効な JSON オブジェクトを入力してください …",
    selector_load_failed: "モデル一覧を取得できませんでした。API 設定を確認してください …",
    test_failed: "モデルのテストに失敗しました。しばらくしてから再試行してください …",
  },
  fields: {
    context_window: {
      title: "コンテキストウィンドウ",
      description: "AGENT タスクにのみ適用。0 = 自動",
    },
    max_output_tokens: {
      title: "最大出力長",
      description: "AGENT タスクにのみ適用。0 = 自動",
    },
    name: {
      title: "モデル名",
      description: "アプリ内の表示に使うモデル名を入力してください。モデルの動作には影響しません",
      placeholder: "モデル名を入力 …",
    },
    api_url: {
      title: "API アドレス",
      description: "API アドレスを入力してください。末尾に /v1 が必要か確認してください",
      placeholder: "API アドレスを入力 …",
    },
    api_key: {
      title: "API キー",
      description:
        "API キー（例：sk-d0daba12345678fd8eb7b8d31c123456）を入力してください。複数のキーは 1 行に 1 つずつ入力すると順番に使用します",
      placeholder: "API キーを入力 …",
    },
    model_id: {
      title: "モデル ID",
      description: "現在のモデル ID は {MODEL} です",
      placeholder: "モデル ID を入力 …",
    },
    thinking: {
      title: "思考レベル",
      description: "モデルの思考動作を設定します。思考時間と消費量に影響します",
    },
    input_token_limit: {
      title: "入力 Token 上限",
      description: "各タスクの入力テキストの最大 Token 数",
    },
    output_token_limit: {
      title: "出力 Token 上限",
      description: "各タスクの出力テキストの最大 Token 数。0 = 自動",
    },
    rpm_limit: {
      title: "1 分あたりのリクエスト上限（RPM）",
      description: "このモデルに対する 1 分あたりのリクエスト数を制限します。0 = 自動",
    },
    concurrency_limit: {
      title: "同時タスク数の上限",
      description: "このモデルで同時に実行するタスク数を制限します。0 = 自動",
    },
    top_p: {
      title: "top_p",
      description:
        "慎重に設定してください。値が不適切だと結果の異常やリクエストエラーにつながります",
    },
    temperature: {
      title: "temperature",
      description:
        "慎重に設定してください。値が不適切だと結果の異常やリクエストエラーにつながります",
    },
    extra_headers: {
      title: "カスタムリクエストヘッダー",
      description:
        "リクエストヘッダーのパラメーターを設定します。値が不適切だと結果の異常やリクエストエラーにつながります",
      placeholder: '例：{"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: "カスタムリクエストボディ",
      description:
        "リクエストボディのパラメーターを設定します。値が不適切だと結果の異常やリクエストエラーにつながります",
      placeholder: '例：{"seed": 42}',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_model_page>;
