import { en_us_project } from "../en-US/project";
import type { zh_cn_project } from "../zh-CN/project";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_project = {
  language: {
    short: en_us_project.language.short,
    title: "プロジェクトの言語",
    source_description: "入力テキストの言語を設定します",
    target_description: "出力テキストの言語を設定します",
  },
  create: {
    title: "プロジェクトを作成",
    loading_toast: "プロジェクトを作成中 …",
    success: "プロジェクトを作成しました …",
    default_preset_loaded: "既定のプリセットを自動で読み込みました：{NAMES} …",
    default_presets: {
      glossary: "用語集",
      text_preserve: "テキスト保護",
      pre_translation_replacement: "翻訳前置換",
      post_translation_replacement: "翻訳後置換",
      translation_prompt: "翻訳プロンプト",
    },
  },
  open: {
    title: "プロジェクトを開く",
    drop_title: "クリックまたは .lg ファイルをドロップ",
    loading_toast: "プロジェクトを読み込み中 …",
    remove_unavailable: "最近使った項目を削除できません。しばらくしてから再試行してください …",
    newer_app_version_description:
      "このファイルの対象アプリバージョンは <emphasis>v{VERSION}</emphasis> です。古いバージョンで開くとデータが破損する可能性があります。続けて開きますか …?",
    missing_file_description: "プロジェクトファイルが利用できません。一覧から削除しますか …?",
  },
  rename: "プロジェクト名を変更",
  close: {
    action: "プロジェクトを閉じる",
    confirm: "現在のプロジェクトを閉じますか …?",
    failed: "プロジェクトを閉じられませんでした。しばらくしてから再試行してください …",
  },
  preview: {
    file_count: "ファイル数",
    files: "{COUNT} 個のファイル",
    created_at: "作成日時",
    updated_at: "最終更新",
    progress: "翻訳進捗",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_project>;
