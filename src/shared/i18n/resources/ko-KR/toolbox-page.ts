import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_toolbox_page = {
  title: "도구 상자",
  entries: {
    game_font: {
      description: "Godot · RenPy · Tyrano · WOLFRPG · RPGMAKER MV/MZ",
    },
    translation_transfer: {
      description:
        "완료된 번역문을 다른 프로젝트로 옮깁니다. 소설이나 게임 등 콘텐츠 업데이트에 주로 사용됩니다",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
