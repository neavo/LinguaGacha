import type { zh_cn_ts_conversion_page } from "../zh-CN/ts-conversion-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_ts_conversion_page = {
  title: "繁体字・簡体字変換",
  description: "プロジェクトの訳文を簡体字中国語と繁体字中国語の間で変換します",
  direction: {
    t2s: "繁体字から簡体字へ",
    s2t: "簡体字から繁体字へ",
  },
  fields: {
    direction: {
      title: "変換モード",
      description:
        "繁体字・簡体字変換には <emphasis>OpenCC</emphasis> を使用します。簡体字から繁体字は S2TW、繁体字から簡体字は T2S ルールを使います",
    },
    preserve_text: {
      title: "テキスト保護ルールに従う",
      description: "テキスト保護ルールに従い、ゲームテキスト内のコードが壊れるのを防ぎます",
    },
    target_name: {
      title: "名前フィールドの訳文を変換",
      description:
        "一部の <emphasis>GalGame</emphasis> では名前が立ち絵や音声などのリソースと紐づいています。翻訳後にエラーが出る場合は無効にできます。既定で有効です",
    },
  },
  action: {
    start: "変換を開始",
    preparing: "繁体字・簡体字変換のデータを準備中 …",
    progress: "繁体字・簡体字を変換中：{CURRENT}/{TOTAL} 件 …",
  },
  confirm: {
    description: "繁体字・簡体字変換を開始しますか？",
  },
  feedback: {
    prefer_native_traditional_chinese:
      "繁体字への直接翻訳をおすすめします：\n基本設定 - 訳文の言語 - 中国語（繁体字）",
    task_success: "タスクが成功しました …",
    task_failed: "タスクの実行に失敗しました …",
    task_running: "タスクが実行中です …",
    project_required: "先にプロジェクトファイルを読み込んでください …",
    no_data: "有効なデータがありません …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_ts_conversion_page>;
