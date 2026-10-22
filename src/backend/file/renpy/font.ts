import type { GameFont } from "../shared/game/font-replace";
import { RENPY_FONT_FILE, RENPY_GENERATED_MARKER } from "./generated";

export const RENPY_DEFAULT_FONT = "game/DejaVuSans.ttf";
export const RENPY_DEFAULT_BOLD_FONT = "game/DejaVuSans-Bold.ttf";

/** 保留游戏字体路径，默认正文字体通过 game 遮蔽，引擎 emoji 资源仍由引擎提供。 */
export function renpy_font_outputs(
  fonts: ReadonlyMap<string, Uint8Array>,
  font: GameFont,
): ReadonlyMap<string, Uint8Array> {
  const outputs = new Map<string, Uint8Array>();
  for (const name of fonts.keys()) outputs.set(name, font.bytes);
  outputs.set(RENPY_DEFAULT_FONT, font.bytes);
  // 已验证引擎把默认粗体映射到这个独立文件，须一起遮蔽才能显示中文粗体。
  outputs.set(RENPY_DEFAULT_BOLD_FONT, font.bytes);
  // init 1999 在语言初始化完成前调整已登记样式，使语言切换恢复的基准也包含断行设置。
  outputs.set(
    RENPY_FONT_FILE,
    Buffer.from(
      `${RENPY_GENERATED_MARKER}\ninit 1999 python:\n    for lg_style in list(renpy.style.styles.values()):\n        if lg_style.language == 'western':\n            lg_style.language = 'unicode'\n`,
    ),
  );
  return outputs;
}
