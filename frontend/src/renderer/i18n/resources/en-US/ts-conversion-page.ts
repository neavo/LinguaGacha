import { zh_cn_ts_conversion_page } from "@/i18n/resources/zh-CN/ts-conversion-page";
import type { LocaleMessageSchema } from "@/i18n/types";

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
        "Conversion is implemented by <emphasis>OpenCC</emphasis>" +
        "\n" +
        "Simplified to Traditional uses S2TW rules, Traditional to Simplified uses T2S rules",
    },
    preserve_text: {
      title: "Follow Text Protection Rules",
      description:
        "Follow text protection rules to avoid damaging code segments in the game text during the conversion process",
    },
    target_name: {
      title: "Convert Name Field Translations",
      description:
        "In some <emphasis>GalGame</emphasis>, name field is bound to resource, which may cause errors after translation"
        + "\n" + "You can disable this feature in that case, enabled by default",
    },
  },
  action: {
    start: "Start Conversion",
    preparing: "Preparing conversion data …",
    progress: "Converting Traditional-Simplified, item {CURRENT} of {TOTAL} …",
  },
  confirm: {
    title: "Alert",
    description: "Start Traditional-Simplified conversion …?",
  },
  feedback: {
    task_success: "Task succeeded …",
    task_failed: "Task failed …",
    task_running: "Task is running …",
    project_required: "Please load a project first …",
    no_data: "No valid data …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_ts_conversion_page>;
