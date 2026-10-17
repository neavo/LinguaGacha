import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_game_font_page = {
  title: "게임 글꼴 교체",
  fields: {
    font_file: { title: "글꼴 파일", description: "TTF 또는 OTF 글꼴 파일을 선택합니다" },
    game_path: { title: "게임 프로그램", description: "게임을 실행하는 프로그램을 선택합니다" },
  },
  action: { pick_file: "파일 선택", pick_executable: "EXE 선택", start: "교체 시작" },
  confirm: { description: "교체하시겠습니까 …?" },
  feedback: {
    inspect_failed: "인식하지 못했습니다 …",
    apply_failed: "교체하지 못했습니다 …",
    applying: "게임 글꼴을 교체하는 중 …",
    apply_success: "글꼴 교체를 완료했습니다 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
