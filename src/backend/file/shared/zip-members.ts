import JSZip from "jszip";
import { AppError } from "../../../shared/error";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { is_portable_relative_path } from "../../../shared/utils/file-name";

/** 落盘前校验完整清单，成员字节按需读取，避免同时解压整包。 */
export async function read_zip_members(
  content: Uint8Array,
  file: string,
): Promise<ReadonlyMap<string, JSZip.JSZipObject>> {
  try {
    const zip = new JSZip();
    // JSZip 按归档记录顺序保留最后一个同名成员，下方校验最终路径集合。
    await zip.loadAsync(content);
    const paths = new ProjectAssetPathIndex(); // 文件及其父目录用于检查双向占用。
    const files = new Map<string, JSZip.JSZipObject>();
    const names = new Set<string>(); // 文件和显式目录共用名称空间，大小写归一后比较。
    for (const entry of Object.values(zip.files)) {
      const raw = entry.unsafeOriginalName ?? entry.name;
      const name = entry.dir ? raw.replace(/\/$/u, "") : raw;
      if (!is_portable_relative_path(name)) throw new Error("Invalid ZIP path: " + raw);
      const key = name.toLowerCase();
      if (name + (entry.dir ? "/" : "") !== entry.name || names.has(key))
        throw new Error("Duplicate or noncanonical ZIP path");
      names.add(key);
      if (!entry.dir) {
        paths.add(name);
        files.set(name, entry);
      }
    }
    // 显式空目录也不能与文件重叠，已有父目录本身允许包含文件。
    for (const entry of Object.values(zip.files)) {
      if (!entry.dir) continue;
      const directory = entry.name.slice(0, -1).toLowerCase();
      const conflict = paths.find_conflict(directory);
      if (conflict !== null && conflict !== directory)
        throw new Error("ZIP file blocks a directory");
    }
    return files;
  } catch (cause) {
    throw new AppError("file.invalid_structure", { cause, public_details: { file } });
  }
}
