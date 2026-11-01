import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

const LICENSE_NAME = /^(?:licen[cs]es?|copying|copyright|notice)(?:$|[-.])/iu;
const LICENSE_TEXT_EXTENSIONS = new Set([
  "",
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".rst",
  ".apache",
  ".bsd",
]);

/** 仅清理构建拥有的生成目录，按文本扩展名保留 license.js 等运行代码。 */
export async function remove_license_files(directory) {
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (
      entry.isFile() &&
      LICENSE_NAME.test(entry.name) &&
      LICENSE_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    )
      await unlink(path.join(entry.parentPath, entry.name));
  }
}
