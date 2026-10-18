/** 原生选择器与后端准入共用支持内部族名解析的字体格式。 */
export const GAME_FONT_INPUT_EXTENSIONS: readonly string[] = ["ttf", "otf"];

/** 既有游戏还可能按 Web 字体路径加载，备份识别与替换目标共用此集合。 */
export const GAME_FONT_EXTENSIONS: readonly string[] = [
  ...GAME_FONT_INPUT_EXTENSIONS,
  "woff",
  "woff2",
];
