import type { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_workbench_page = {
  title: "ワークベンチ",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "ファイル名",
    line_count: "行数",
    actions: "操作",
  },
  sort: {
    ascending: "昇順で並べ替え",
    descending: "降順で並べ替え",
    clear: "並べ替えを解除",
  },
  feedback: {
    refresh_failed: "ワークベンチを更新できませんでした",
    add_file_loading_toast: "ファイルを追加し、キャッシュを更新中 …",
    no_valid_file: "追加できる有効なファイルがありません。",
    file_action_failed: "ファイル操作に失敗しました。しばらくしてから再試行してください。",
    generate_translation_failed:
      "現在の訳文を出力できませんでした。しばらくしてから再試行してください。",
    close_project_failed:
      "プロジェクトを閉じられませんでした。しばらくしてから再試行してください。",
  },
  action: {
    add_file: "追加",
    generate_translation: "訳文を出力",
    close_project: "プロジェクトを閉じる",
    reset: "翻訳状態をリセット",
    translation_task: "翻訳",
    start_translation: "翻訳を開始",
    reset_task_all: "すべてのデータをリセット",
    reset_task_failed: "失敗したデータをリセット",
  },
  translation_export: {
    checking: "校正の警告を確認中 …",
    check_failed: "校正の警告を読み込めませんでした。現在の訳文は引き続き出力できます。",
    warning_description:
      "校正の警告が {COUNT} 件あります。AGENT で自動校正してから訳文を出力することをおすすめします。このまま続けますか？",
    warning_list: "校正の警告",
    retry_check: "再確認",
    continue_generate: "出力を続ける",
  },
  reorder: {
    failed: "ファイルの順序を保存できませんでした。しばらくしてから再試行してください。",
  },
  dialog: {
    import_conflict: {
      description: "同名のファイルが {COUNT} 個あります。処理方法を選択してください。",
    },
    inherit_import: {
      description: "現在のプロジェクトの翻訳済みテキストを使って、新しいファイルを埋めますか？",
      fill: "埋める",
      do_not_fill: "埋めない",
    },
    reset: {
      description: "このファイルの翻訳状態をリセットしますか？",
    },
    delete: {
      description: "選択したファイルと、そのすべての翻訳項目を削除しますか？",
    },
    close_project: {
      description: "現在のプロジェクトを閉じますか？",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;
