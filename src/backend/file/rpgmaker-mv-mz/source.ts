import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import type { ProjectSourceFileEntry } from "../file-format-shared";

type RPGMakerSource = { root: string; data_root: string }; // 游戏身份与可能位于 `www` 的运行数据分开定位。

/** 游戏标志文件约束发现范围，普通 JSON 仍走通用格式入口。 */
export function discover_rpgmaker_source(source: string, fs: NativeFs): RPGMakerSource | null {
  if (!fs.exists(source)) return null;
  const root = fs.stat(source).isDirectory()
    ? path.resolve(source)
    : path.extname(source).toLowerCase() === ".exe"
      ? path.dirname(path.resolve(source))
      : null;
  if (root === null) return null;
  const data_root = find_data_root(root, fs);
  if (data_root === undefined) return null;
  return { root, data_root };
}

/** 仅原稿准备展开内部文件，摘要和来源识别无需遍历整个游戏。 */
export function collect_rpgmaker_files(
  { root, data_root }: RPGMakerSource,
  fs: NativeFs,
): Pick<ProjectSourceFileEntry, "source_path" | "rel_path">[] {
  const files: string[] = [];
  // 只收集游戏数据和插件，路径保持相对游戏根目录。
  function collect(directory: string, extension: string): void {
    if (!fs.exists(directory)) return;
    for (const entry of fs.read_dirents(directory).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file, extension);
      else if (entry.isFile() && path.extname(file).toLowerCase() === extension) files.push(file);
    }
  }
  collect(path.join(data_root, "data"), ".json");
  const plugins = path.join(data_root, "js", "plugins.js");
  if (fs.exists(plugins)) files.push(plugins);
  collect(path.join(data_root, "js", "plugins"), ".js");
  return files.map((file) => ({
    source_path: file,
    rel_path: path.relative(root, file).replace(/\\/gu, "/"),
  }));
}

/** MV 打包可能把运行数据放在 `www`，标志文件共同确认游戏根目录。 */
function find_data_root(root: string, fs: NativeFs): string | undefined {
  return [root, path.join(root, "www")].find(
    (candidate) =>
      fs.exists(path.join(candidate, "data", "System.json")) &&
      (fs.exists(path.join(candidate, "js", "rpg_core.js")) ||
        fs.exists(path.join(candidate, "js", "rmmz_core.js"))),
  );
}
