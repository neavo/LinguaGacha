import JSZip from "jszip";
import { AppError } from "../../shared/error";
import { ProjectAssetPathIndex } from "../../shared/project/project-asset-paths";

/** 落盘前校验完整清单，成员字节按需读取，避免同时解压整包。 */
export async function read_zip_members(
  content: Uint8Array,
  file: string,
): Promise<ReadonlyMap<string, JSZip.JSZipObject>> {
  try {
    const zip = new JSZip();
    // JSZip 默认覆盖同名记录，必须在清单写入时拒绝，加载后已无法识别丢失的成员。
    zip.files = new Proxy(zip.files, {
      set(files, name, entry: JSZip.JSZipObject) {
        if (Object.hasOwn(files, name)) throw new Error("Duplicate ZIP member");
        return Reflect.set(files, name, entry);
      },
    });
    await zip.loadAsync(content);
    const paths = new ProjectAssetPathIndex(); // 文件及其父目录用于检查双向占用。
    const files = new Map<string, JSZip.JSZipObject>();
    const names = new Set<string>(); // 文件和显式目录共用名称空间，大小写归一后比较。
    for (const entry of Object.values(zip.files)) {
      const raw = entry.unsafeOriginalName ?? entry.name;
      const name = validate_zip_member_path(entry.dir ? raw.replace(/\/$/u, "") : raw);
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

/** 内部路径跨平台保存，拒绝越界和 Windows 路径别名。 */
export function validate_zip_member_path(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  if (
    !normalized ||
    normalized
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[:<>"|?*\p{Cc}]/u.test(part) ||
          /[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    throw new AppError("file.invalid_structure", { public_details: { file: value } });
  return normalized;
}
