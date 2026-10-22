/** 原生选择器与后端准入只接受 TTF 输入。 */
export const GAME_FONT_INPUT_EXTENSIONS: readonly string[] = ["ttf"];

/** 游戏替换目标独立于输入格式，保留既有 Web 字体路径。 */
export const GAME_FONT_EXTENSIONS: readonly string[] = ["ttf", "otf", "woff", "woff2"];
