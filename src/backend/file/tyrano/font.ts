import assert from "node:assert/strict";
import type { NativeFs } from "../../../native/native-fs";
import type { GameFont } from "../shared/game/font-replace";
import {
  collect_game_source_files,
  type GameSourceFiles,
  type PreparedGameFiles,
} from "../shared/game/source-files";
import { tyrano_path, type TyranoSource } from "./source";

const STYLE_FILE = "tyrano/tyrano.css"; // 引擎页面加载的主样式表。
const FONT_FILE = "tyrano/css/linguagacha-font.ttf";
const FONT_STYLE_FILE = "tyrano/css/linguagacha-font.css";
const FONT_STYLE_MARKER = "/* LinguaGacha font v1 */"; // 标记生成样式归字体工具所有，重复替换时可以覆盖。
const BOM = String.fromCharCode(0xfeff); // 样式表开头的 BOM 须留在首个规则之前。
const FONT_STYLE_HOOK = '@import url("./css/linguagacha-font.css");\n'; // `@import` 必须位于样式表开头。
/** 覆盖消息框、文字层与选项按钮。图片文字、Canvas 与自定义绘制不在范围内。 */
const FONT_STYLE = `${FONT_STYLE_MARKER}
@font-face { font-family: "LinguaGacha"; src: url("./linguagacha-font.ttf"); }
#tyrano_base p, #tyrano_base p *, #tyrano_base .message_inner, #tyrano_base .message_inner *, #tyrano_base .glink_button, #tyrano_base .text_box { font-family: "LinguaGacha", sans-serif !important; }
`;

/** 读取主样式表与已有生成样式。同名但不带产品标记的文件属于游戏，不能覆盖。 */
export function collect_tyrano_fonts(
  game: TyranoSource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceFiles {
  const style = tyrano_path(game, STYLE_FILE);
  const font_style = tyrano_path(game, FONT_STYLE_FILE);
  return collect_game_source_files(
    game.root,
    [style, tyrano_path(game, "tyrano/css")],
    (files, read) => {
      assert(files.has(style), "TyranoScript stylesheet not found: " + style);
      const owned =
        files.has(font_style) &&
        Buffer.from(read(font_style)).toString("utf8").startsWith(FONT_STYLE_MARKER);
      assert(
        owned || (!files.has(font_style) && !files.has(tyrano_path(game, FONT_FILE))),
        "Existing game file conflicts with LinguaGacha font files: " + font_style,
      );
      return [style];
    },
    null,
    fs,
    signal,
    prepared,
  );
}

/** 字体工具独占生成的字体、样式和主样式表首行导入，重复执行只保留一行导入。 */
export function tyrano_font_outputs(
  game: TyranoSource,
  files: GameSourceFiles,
  font: GameFont,
): ReadonlyMap<string, Uint8Array> {
  const style = tyrano_path(game, STYLE_FILE);
  const source = Buffer.from(files.data.get(style)!).toString("utf8");
  const bom = source.startsWith(BOM) ? BOM : "";
  const body = source.slice(bom.length);
  return new Map<string, Uint8Array>([
    [tyrano_path(game, FONT_FILE), font.bytes],
    [tyrano_path(game, FONT_STYLE_FILE), Buffer.from(FONT_STYLE)],
    [style, Buffer.from(body.startsWith(FONT_STYLE_HOOK) ? source : bom + FONT_STYLE_HOOK + body)],
  ]);
}
