import { zh_cn_ts_conversion_page } from "../zh-CN/ts-conversion-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_ts_conversion_page = {
  title: "Traditional-Simplified Conversion",
  description:
    "Convert translated text in the project between Simplified Chinese and Traditional Chinese",
  direction: {
    t2s: "Traditional to Simplified",
    s2t: "Simplified to Traditional",
  },
  fields: {
    direction: {
      title: "Conversion Mode",
      description:
        "<emphasis>OpenCC</emphasis>: S2TW for Simplified → Traditional; T2S for Traditional → Simplified.",
    },
    preserve_text: {
      title: "Follow Text Protection Rules",
      description:
        "Follow text protection rules to avoid damaging code segments in the game text during the conversion process",
    },
    target_name: {
      title: "Convert Name Field Translations",
      description:
        "In some <emphasis>GalGame</emphasis>, names link to image or voice files. Disable if translating names causes errors. Enabled by default.",
    },
  },
  action: {
    start: "Start Conversion",
    preparing: "Preparing conversion data …",
    progress: "Converting Traditional-Simplified, item {CURRENT} of {TOTAL} …",
  },
  confirm: {
    description: "Confirm starting Chinese script conversion …?",
  },
  feedback: {
    prefer_native_traditional_chinese:
      "Recommended: use the native Traditional Chinese translation feature:\nBasic Settings - Target Language - Traditional Chinese",
    task_success: "Task succeeded …",
    task_failed: "Task failed …",
    task_running: "Task is running …",
    project_required: "Please load a project first …",
    no_data: "No valid data …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_ts_conversion_page>;
