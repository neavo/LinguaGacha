import type { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_workbench_page = {
  title: "ワークベンチ",
  unit: {
    item: "Items",
  },
  table: {
    file_name: "ファイル名",
    progress: "進捗",
    agent: "AGENT",
    agent_writeback: "元の形式への書き戻しには AGENT が必要",
    agent_only: "AGENT でのみ翻訳できます",
    agent_recommended: "翻訳には AGENT の使用をおすすめします",
  },
  feedback: {
    no_valid_file: "追加できる有効なファイルがありません",
  },
  action: {
    add_file: "追加",
    rename: "名前を変更",
    reset: "ファイルデータをリセット",
    translation_task: "翻訳",
    start_translation: "翻訳を開始",
    reset_task_all: "すべてのデータをリセット",
  },
  dialog: {
    import_conflict: {
      description: "同名のファイルが {COUNT} 個あります。処理方法を選択してください …",
    },
    inherit_import: {
      description: "翻訳済みの訳文を使って、インポートしたファイルを埋めますか …?",
      fill: "埋める",
      do_not_fill: "埋めない",
    },
    rename: {
      exists: "同じ名前のファイルまたはフォルダーが既に存在します",
      invalid_name:
        '名前は空にできず、\\ / : * ? " < > | を含めることも、ドットで終わることもできません',
    },
    reset: {
      description: "選択したファイルと、そのすべての翻訳項目をリセットしますか …?",
    },
    delete: {
      description: "選択したファイルと、そのすべての翻訳項目を削除しますか …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;
