import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_game_font_page = {
  title: "게임 글꼴 변경",
  fields: {
    game: { title: "게임", description: "클릭하거나 게임 프로그램 또는 폴더 놓기" },
    font_file: {
      title: "글꼴 파일",
      description: "클릭하거나 글꼴 파일 놓기",
      hint: "TTF 지원",
    },
  },
  action: {
    pick_executable: "게임 프로그램 선택",
    pick_directory: "게임 폴더 선택",
    start: "변경 시작",
  },
  feedback: {
    inspect_failed: "인식하지 못했습니다 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
