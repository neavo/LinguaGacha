import type { zh_cn_app } from "../zh-CN/app";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_app = {
  metadata: {
    app_name: "LinguaGacha",
  },
  model: {
    type: {
      preset: "プリセットモデル",
      google: "カスタム Google モデル",
      openai: "カスタム OpenAI モデル",
      openai_responses: "カスタム OpenAI Responses モデル",
      anthropic: "カスタム Anthropic モデル",
    },
    selection: {
      label: "モデルを選択",
      unavailable: "利用できるモデルがありません",
      load_failed: "モデル選択を読み込めませんでした。しばらくしてから再試行してください …",
      update_failed: "モデル選択を保存できませんでした。しばらくしてから再試行してください …",
    },
    thinking_level: {
      label: "思考レベル",
      default: "既定",
      unsupported: "選択したモデルには未対応です",
      off: "オフ",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "非常に高い",
      max: "最大",
    },
  },
  action: {
    add: "追加",
    cancel: "キャンセル",
    confirm: "確認",
    close: "閉じる",
    create: "追加",
    delete: "削除",
    edit: "編集",
    export: "エクスポート",
    import: "インポート",
    preset: "プリセット",
    query: "検索",
    reset: "リセット",
    retry: "再試行",
    save: "保存",
    skip: "スキップ",
    overwrite: "上書き",
    replace: "置換",
    go_to_agent: "AGENT を開く",
    loading: "読み込み中",
    select_file: "ファイルを選択",
    select_folder: "フォルダーを選択",
  },
  feedback: {
    initial_load_failed: "アプリのデータを読み込めませんでした。再試行してください。",
    export_success: "データをエクスポートしました …",
    import_success: "データをインポートしました …",
    no_valid_data: "有効なデータがありません …",
    update_failed: "更新できませんでした …",
    project_settings_aligned: "現在の設定に合わせてプロジェクト設定を更新しました …",
  },
  error_boundary: {
    eyebrow: "Renderer Runtime",
    title: "ページの実行中にエラーが発生しました",
    description:
      "このウィンドウは保護画面に切り替わりました。エラーの詳細はログに記録されています。",
  },
  project_settings_alignment: {
    field: {
      source_language: "入力言語",
      target_language: "出力言語",
      mtool_optimizer_enable: "MTool オプティマイザー",
      skip_duplicate_source_text_enable: "重複する原文をスキップ",
    },
  },
  close_confirm: {
    description: "アプリを終了しますか？",
  },
  quality_rule_import: {
    duplicate_description: "重複するルールが {COUNT} 件あります。処理方法を選択してください。",
  },
  update: {
    confirm_description: "LinguaGacha v{VERSION} が見つかりました。更新をダウンロードしますか？",
    restart_confirm: "再起動して更新",
    launching: "処理中 …",
  },
  drop: {
    multiple_unavailable: "一度にドロップできるファイルは 1 個です",
    unavailable:
      "ドロップしたファイルのローカルパスを取得できません。クリックしてインポートしてください。",
    import_here: "ドロップしてルールファイルをインポート",
  },
  toggle: {
    option: {
      disabled: "無効",
      enabled: "有効",
    },
  },
  state: {
    disabled: "無効",
    enabled: "有効",
  },
  editor: {
    line_wrap_target: "{TARGET}を折り返す",
  },
  tooltip: {
    value: "{TITLE} · {VALUE}",
  },
  drag: {
    enabled: "ドラッグして並べ替え",
    disabled: "ドラッグ不可",
    handle: "ドラッグ",
  },
  language: {
    ALL: "すべて",
    ZH: "中国語",
    "ZH-HANT": "中国語（繁体字）",
    EN: "英語",
    JA: "日本語",
    KO: "韓国語",
    RU: "ロシア語",
    AR: "アラビア語",
    DE: "ドイツ語",
    FR: "フランス語",
    PL: "ポーランド語",
    ES: "スペイン語",
    IT: "イタリア語",
    PT: "ポルトガル語",
    HU: "ハンガリー語",
    TR: "トルコ語",
    TH: "タイ語",
    ID: "インドネシア語",
    VI: "ベトナム語",
  },
  navigation_action: {
    appearance: "外観",
    font: "フォント",
    font_option: {
      lg_base: "LGBase",
      system: "システムフォント",
    },
    theme: "テーマ",
    theme_option: {
      system: "システムに合わせる",
      light: "ライト",
      dark: "ダーク",
    },
    language: "言語",
    logs: "ログ",
  },
  profile: {
    status: "Ciallo～(∠・ω< )⌒✮",
    status_tooltip: "GitHub のプロジェクトページを開く",
    update_available: "クリックして新しいバージョンをダウンロード！",
    update_available_tooltip: "更新の確認画面を開く",
  },
  prompt: {
    source: "原文",
    builder_control_character_samples: "制御文字の例：",
    builder_glossary_header: "用語集 <原語> -> <訳語> #<用語情報>:",
    builder_input: "入力：",
    builder_preceding_context: "前の文脈：",
  },
  translation_export: {
    directory: {
      translated: "訳文",
      bilingual: "訳文_対訳",
    },
  },
  native_file_filter: {
    project: "LinguaGacha プロジェクト",
    supported_json_xlsx_files: "対応ファイル (*.json *.xlsx)",
    json_files: "JSON ファイル (*.json)",
    excel_files: "Excel ファイル (*.xlsx)",
    supported_txt_files: "対応ファイル (*.txt)",
  },
  error: {
    request: {
      validation_failed: {
        message: "リクエストのパラメーターが無効です …",
      },
      invalid_json: {
        message: "リクエストの JSON が無効です …",
      },
      route_not_found: {
        message: "API ルートが見つかりません …",
      },
    },
    project: {
      not_loaded: {
        message: "プロジェクトが読み込まれていません …",
      },
      not_found: {
        message: "プロジェクトファイルが見つかりません …",
      },
    },
    file: {
      not_found: {
        message: "ファイルが見つかりません …",
      },
      parse_failed: {
        message: "ファイルの内容を解析できませんでした …",
      },
      invalid_structure: {
        message: "ファイルの構造が形式の要件を満たしていません …",
      },
      io_failed: {
        message: "ファイルの読み書きに失敗しました …",
      },
    },
    database: {
      conflict: {
        message: "データベースへの書き込みが競合しました。更新して再試行してください …",
      },
    },
    data: {
      revision_conflict: {
        message: "データのバージョンが変わりました。更新して再試行してください …",
      },
      committed_sync_failed: {
        message: "データは保存されましたが、画面の同期に失敗しました …",
      },
    },
    model: {
      not_found: {
        message: "モデル設定が見つかりません …",
      },
      provider_failed: {
        message: "モデルサービスへのリクエストに失敗しました。API 設定を確認してください …",
      },
    },
    worker: {
      failed: {
        message: "バックグラウンド実行チャネルでエラーが発生しました …",
      },
      execution_failed: {
        message: "バックグラウンドタスクの実行に失敗しました …",
      },
    },
    runtime: {
      busy: {
        message: "モデルが実行中です。しばらくしてから再試行してください …",
      },
      capability_missing: {
        message: "現在の実行環境に必要な機能がありません …",
      },
      disposed: {
        message: "実行リソースは解放されています …",
      },
      cancelled: {
        message: "操作をキャンセルしました …",
      },
      internal_invariant: {
        message: "内部状態に異常があります …",
      },
    },
    language: {
      invalid_target_language: {
        message: "翻訳先の言語が無効です …",
      },
      unsupported_all_target_language: {
        message: "翻訳先に「すべて」は指定できません …",
      },
      unknown_source_language_code: {
        message: "原文の言語コードが無効です …",
      },
    },
    quality: {
      unknown_rule_type: {
        message: "品質ルールの種類が無効です …",
      },
      unsupported_rule_meta: {
        message: "品質ルールの設定項目が無効です …",
      },
    },
    prompt: {
      unknown_prompt_type: {
        message: "プロンプトの種類が無効です …",
      },
    },
    desktop: {
      missing_backend_api_base_url: {
        message: "Backend API のアドレスが設定されていません …",
      },
      http_error: {
        message: "リクエストに失敗しました：{PATH} …",
      },
      network_failed: {
        message: "ネットワークリクエストに失敗しました：{PATH} …",
      },
      timeout: {
        message: "リクエストがタイムアウトしました：{PATH} …",
      },
    },
  },
  diagnostic: {
    agent: {
      model_round_failed: "Agent のモデルターンに失敗しました …",
      context_compaction_failed: "Agent のコンテキスト圧縮に失敗しました …",
      session_cleanup_failed: "Agent のセッションをクリーンアップできませんでした …",
      tool_execution_failed: "Agent のツール実行中にエラーが発生しました …",
      skill_load_failed: "Agent スキルを読み込めませんでした …",
      skill_resource_load_failed: "Agent スキルのリソースを読み込めませんでした …",
    },
    api_gateway: {
      direct_route_failed: "API Gateway の直接ルート処理に失敗しました …",
    },
    default_preset: {
      config_normalize_failed: "既定のプリセット設定を正規化できませんでした：{CONFIG_PATH} …",
      prompt_load_failed: "既定のプロンプトプリセットを読み込めませんでした …",
      quality_rule_load_failed: "既定の品質ルールプリセットを読み込めませんでした …",
      value_normalize_failed:
        "既定のプリセット値を正規化できませんでした：{PRESET_DIRECTORY} -> {VALUE} …",
    },
    file_export: {
      open_output_folder_failed: "出力フォルダーを開けませんでした …",
      translation_failed: "訳文を生成できませんでした …",
      write_file_failed: "ファイルに書き込めませんでした …",
    },
    lifecycle: {
      app_start_failed: "LinguaGacha を起動できませんでした …",
      backend_gateway_start_failed: "Backend / Gateway を起動できませんでした …",
      main_fatal_uncaught: "Electron main で未処理の致命的な例外が発生しました …",
    },
    migration: {
      path_failed: "パスを移行できませんでした：{SOURCE_PATH} -> {DESTINATION_PATH} …",
    },
    renderer: {
      main_frame_load_failed: "レンダラーのメインフレームを読み込めませんでした …",
      process_exited: "レンダラープロセスが終了しました …",
      reported_error: "Renderer でフロントエンド実行時エラーが発生しました …",
      subframe_load_failed: "レンダラーのサブフレームを読み込めませんでした …",
      window_unresponsive: "ウィンドウが応答していません …",
    },
  },
  log: {
    api_gateway_started: "API Gateway を起動しました - {BASE_URL}",
    api_test_fail: "API テストに失敗しました …",
    api_test_key: "テスト中のキー：",
    api_test_messages: "タスクのプロンプト：",
    api_test_result: "API を {COUNT} 件テストしました。成功 {SUCCESS} 件、失敗 {FAILURE} 件 …",
    api_test_result_failure: "失敗したキー：",
    api_test_response_result: "モデルの返信：",
    api_test_timeout: "リクエストがタイムアウトしました（{SECONDS} 秒）",
    api_test_token_info: "所要時間 {TIME} 秒、入力 {PT} Tokens、思考 {RT} Tokens、出力 {CT} Tokens",
    app_version: "LinguaGacha v{VERSION} …",
    default_preset_loaded: "既定のプリセットを自動で読み込みました：{NAMES} …",
    engine_api_model: "API モデル",
    engine_api_name: "API 名",
    engine_api_url: "API アドレス",
    engine_task_done: "タスクが完了しました …",

    engine_task_fail:
      "タスクの一部が完了していません。未処理のデータがあるため、処理結果を確認してください …",
    engine_task_rule_analysis: "ルール分析：",
    engine_task_thinking_process: "思考過程：",
    engine_task_stop: "タスクを停止しました …",
    engine_task_success:
      "所要時間 {TIME} 秒、テキスト {LINES} 行、入力 {PT} Tokens、思考 {RT} Tokens、出力 {CT} Tokens",
    generate_translation_done: "訳文を {PATH} に保存しました …",
    generate_translation_start: "訳文を生成中 …",
    model_response_invalid: "モデルから返されたデータが無効です …",
    request_failed: "リクエストに失敗しました：{ERROR} …",
    request_timeout: "ネットワークリクエストがタイムアウトしました",
    system_closed_dropped: "ログシステムは終了しています。新しいログを破棄しました：{MESSAGE}",
    translation_task_result: "翻訳結果：",
    translation_response_partially_invalid: "一部の訳文が検証に失敗しました …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app>;
