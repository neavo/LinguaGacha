import JSZip from "jszip";
import { write_zip, type ZipContents } from "../backend/file/zip";

export { write_zip };
export type { ZipContents };

/** 测试编辑夹具使用普通 Map，生产读取仍按需解压。 */
export async function read_zip_fixture(bytes: Uint8Array): Promise<ZipContents> {
  const archive = await JSZip.loadAsync(bytes);
  const files: ZipContents = new Map();
  for (const entry of Object.values(archive.files))
    if (!entry.dir) files.set(entry.name, await entry.async("uint8array"));
  return files;
}

/** 已修改成员可能是字符串，其余成员按 UTF-8 读取。 */
export function zip_text(files: ZipContents, path: string): string {
  const value = files.get(path);
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}
