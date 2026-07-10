import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_toolbox_page = {
  title: "Werkzeugkiste",
  entries: {
    ts_conversion: {
      title: "TS-Konvertierung",
      description:
        "Konvertieren Sie den Zieltext oder Zeichennamen stapelweise zwischen traditionellem und vereinfachtem Chinesisch mit Textschutz",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
