import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_game_font_page = {
  title: "게임 글꼴 변경",
  fields: {
    game: { title: "게임", description: "클릭하거나 게임 프로그램 또는 폴더 놓기" },
    font_file: {
      title: "글꼴 파일",
      description: "클릭하거나 글꼴 파일 놓기",
      hint: "TTF, OTF 지원",
    },
  },
  action: {
    pick_executable: "게임 프로그램 선택",
    pick_directory: "게임 폴더 선택",
    start: "변경 시작",
  },
  confirm: { description: "게임 글꼴을 변경하시겠습니까 …?" },
  feedback: {
    inspect_failed: "인식하지 못했습니다 …",
    apply_failed: "변경하지 못했습니다 …",
    applying: "게임 글꼴을 변경하는 중 …",
    apply_success: "게임 글꼴 변경을 완료했습니다 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
