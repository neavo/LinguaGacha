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
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "Preceding lines threshold must be a number within the valid range …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
