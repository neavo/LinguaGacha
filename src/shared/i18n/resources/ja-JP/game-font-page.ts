import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_game_font_page = {
  title: "ゲームフォント置換",
  fields: {
    font_file: {
      title: "フォントファイル",
      description: "TTF または OTF のフォントファイルを選択します",
    },
    game_path: { title: "ゲームプログラム", description: "ゲームの起動プログラムを選択します" },
  },
  action: { pick_file: "ファイルを選択", pick_executable: "EXE を選択", start: "置換を開始" },
  confirm: {
    description: "置換してもよろしいですか …?",
  },
  feedback: {
    inspect_failed: "判定に失敗しました …",
    apply_failed: "置換に失敗しました …",
    applying: "ゲームフォントを置換しています …",
    apply_success: "フォントの置換が完了しました …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
