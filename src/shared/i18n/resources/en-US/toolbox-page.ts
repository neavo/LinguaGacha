import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_toolbox_page = {
  title: "Toolbox",
  entries: {
    ts_conversion: {
      title: "TS Conversion",
      description:
        "Batch convert the target text or character names between Traditional and Simplified Chinese with text protection",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
