import type { zh_cn_preset_editor } from "../zh-CN/preset-editor";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_preset_editor = {
  action: {
    apply: "インポート",
    cancel_default: "既定のプリセットを解除",
    delete: "プリセットを削除",
    rename: "名前を変更",
    save: "プリセットを保存",
    set_default: "既定のプリセットに設定",
  },
  confirm: {
    delete: {
      description: "プリセットを削除しますか …?",
    },
    overwrite: {
      description: "プリセットを上書きしますか …?",
    },
  },
  dialog: {
    name_placeholder: "プリセット名を入力 …",
  },
  feedback: {
    exists: "ファイルは既に存在します",
    name_required: "プリセット名を入力してください",
    load_failed: "プリセットを読み込めませんでした",
    save_failed: "プリセットを保存できませんでした",
    rename_failed: "プリセット名を変更できませんでした",
    delete_failed: "プリセットを削除できませんでした",
    default_update_failed: "既定のプリセット設定を保存できませんでした",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
