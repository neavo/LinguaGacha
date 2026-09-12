import type { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_expert_settings_page = {
  title: "エキスパート設定",
  fields: {
    preceding_lines_threshold: {
      title: "参照する前文の最大行数",
      description: "各翻訳タスクに添付できる前文の最大行数です。既定では無効です",
    },
    clean_ruby: {
      title: "原文のルビを除去",
      description:
        "ルビの読みを除去し、本文だけを残します。既定では無効です" +
        "\n" +
        "モデルはルビを正しく解釈できないことが多いため、除去すると翻訳品質の向上につながります。対応形式の例：" +
        "\n" +
        "• <ruby>漢字<rt>かんじ</rt></ruby>" +
        "\n" +
        "• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]" +
        "\n" +
        "• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]" +
        "\n" +
        '• [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]',
    },
    deduplication_in_bilingual: {
      title: "対訳ファイルで原文と訳文が同じ場合は 1 回だけ出力",
      description: "字幕と電子書籍で原文と訳文が同じ場合、1 回だけ出力します。既定で有効です",
    },
    write_translated_name_fields_to_file: {
      title: "名前フィールドの訳文を出力ファイルに書き込む",
      description:
        "一部の <emphasis>GalGame</emphasis> では名前が立ち絵や音声などのリソースと紐づいています。翻訳後にエラーが出る場合は無効にできます。既定で有効です" +
        "\n" +
        "対応形式：" +
        "\n" +
        "• RenPy から出力したゲームテキスト（.rpy）" +
        "\n" +
        "• VNTextPatch または SExtractor から出力した name フィールド付きゲームテキスト（.json）",
    },
    auto_process_prefix_suffix_preserved_text: {
      title: "先頭・末尾の保護テキストを自動処理",
      description:
        "各テキスト項目の先頭・末尾で保護ルールに一致する部分を自動処理します。既定で有効です" +
        "\n" +
        "• 有効にすると、先頭・末尾で保護ルールに一致する部分を取り除き、翻訳後に元の位置へ戻します" +
        "\n" +
        "• 無効にすると、テキスト全体をモデルに送信します。文脈をより正確に伝えられる場合がありますが、テキストの保護効果は低下します",
    },
  },
  feedback: {
    refresh_failed: "エキスパート設定を更新できません。しばらくしてから再試行してください。",
    update_failed: "設定を保存できませんでした。しばらくしてから再試行してください。",
    preceding_lines_threshold_invalid: "前文の最大行数には有効な範囲の数値を入力してください。",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
