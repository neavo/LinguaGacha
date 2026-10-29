import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_game_font_page = {
  title: "ゲームフォント変更",
  fields: {
    game: { title: "ゲーム", description: "クリックまたはゲームプログラムかフォルダーをドロップ" },
    font_file: {
      title: "フォントファイル",
      description: "クリックまたはフォントファイルをドロップ",
      hint: "TTF に対応",
    },
  },
  action: {
    pick_executable: "ゲームプログラムを選択",
    pick_directory: "ゲームフォルダーを選択",
    start: "変更を開始",
  },
  feedback: {
    inspect_failed: "判定に失敗しました …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
