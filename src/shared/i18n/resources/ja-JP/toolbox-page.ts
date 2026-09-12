import type { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_toolbox_page = {
  title: "ツールボックス",
  entries: {
    ts_conversion: {
      title: "繁体字・簡体字変換",
      description: "プロジェクトの訳文・キャラクター名を一括で繁簡変換。テキスト保護に対応。",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
