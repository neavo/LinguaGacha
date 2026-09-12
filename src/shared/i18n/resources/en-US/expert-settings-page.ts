import { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_expert_settings_page = {
  title: "Expert Settings",
  fields: {
    preceding_lines_threshold: {
      title: "Preceding Lines Threshold",
      description:
        "Maximum number of preceding lines to include as context for each translation task, disabled by default",
    },
    clean_ruby: {
      title: "Clean Ruby Text",
      description:
        "Remove ruby readings, keep base text (off by default). Models often misread ruby; removal may improve translation. Supported formats include:" +
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
      title: "Output Only Once if Source and Target are Identical in Bilingual Output Files",
      description:
        "In subtitles or e-books, whether to output text only once if the source and target text are identical, enabled by default",
    },
    write_translated_name_fields_to_file: {
      title: "Write Translated Name Fields to the Output File",
      description:
        "Some <emphasis>GalGame</emphasis> names link to image or voice files. Disable name translation if it causes errors (on by default)." +
        "\n" +
        "Supported formats:" +
        "\n" +
        "• RenPy exported game text (.rpy)" +
        "\n" +
        "• VNTextPatch or SExtractor exported game text with name fields (.json)",
    },
    auto_process_prefix_suffix_preserved_text: {
      title: "Auto Process Prefix/Suffix Preserved Text",
      description:
        "Whether to auto-process text segments at the start/end that match preserve rules, enabled by default" +
        "\n" +
        "• Enabled: Removes segments matching preserve rules and restores them after translation" +
        "\n" +
        "• Disabled: Sends the full text for better context, but may reduce preserve effectiveness",
    },
  },
  feedback: {
    refresh_failed: "Unable to refresh expert settings right now. Please try again later.",
    update_failed: "Failed to save the setting. Please try again later.",
    preceding_lines_threshold_invalid:
      "Preceding lines threshold must be a number within the valid range.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
