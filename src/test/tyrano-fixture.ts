import path from "node:path";
import type { NativeFs } from "../native/native-fs";
import type { TyranoParser } from "../backend/file/tyrano/scene";

/** 解析器只需带版本标识，测试不依赖真实引擎源码。 */
const PARSER_SOURCE: Readonly<Record<TyranoParser, string>> = {
  legacy: "var flag_quot_c, cnt_quot_c, num_kakko;",
  modern: "var start_quot, end_char_of_param_value = config.KeepSpaceInParameterValue;",
};

/** 最小 TyranoScript 应用目录：识别标志、配置、主样式表与给定数据文件。 */
export function write_tyrano_app(
  native: NativeFs,
  app: string,
  files: Readonly<Record<string, string>> = {},
  parser: TyranoParser = "modern",
): void {
  const all = {
    "tyrano/plugins/kag/kag.parser.js": PARSER_SOURCE[parser],
    "tyrano/tyrano.css": '@import url("./css/font.css");\n',
    "data/system/Config.tjs": ";System.title = テスト\n;projectID = test\n",
    "data/scenario/first.ks": "こんにちは[p]\n",
    ...files,
  };
  for (const [name, text] of Object.entries(all))
    native.write_file_sync(path.join(app, name), text);
}
