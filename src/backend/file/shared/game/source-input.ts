import path from "node:path";
import type { NativeFs } from "../../../../native/native-fs";

/** 只解析原生游戏入口，布局与封装由引擎确认。 */
export function resolve_game_source_input(
  input: string,
  fs: NativeFs,
): Readonly<{ root: string; executable: string | null }> | null {
  if (!fs.exists(input)) return null;
  const stat = fs.stat(input);
  if (stat.isDirectory()) return { root: path.resolve(input), executable: null }; // 目录名可以带扩展名。
  if (!stat.isFile() || path.extname(input).toLowerCase() !== ".exe") return null;
  const executable = path.resolve(input);
  return { root: path.dirname(executable), executable };
}
