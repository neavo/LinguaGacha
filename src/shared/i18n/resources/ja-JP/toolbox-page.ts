import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_toolbox_page = {
  title: "ツールボックス",
  entries: {
    game_font: {
      description: "Godot · RenPy · Tyrano · WOLFRPG · RPGMAKER MV/MZ",
    },
    translation_transfer: {
      description:
        "完了済みの訳文を別のプロジェクトに移行します。小説やゲームなどのアップデートによく使われます",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
