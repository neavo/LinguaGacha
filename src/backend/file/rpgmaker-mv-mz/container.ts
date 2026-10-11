import type JSZip from "jszip";
import { AppError } from "../../../shared/error";
import { read_zip_members } from "../zip-members";

/** RM 固化容器必须包含文件，空容器不能作为游戏原稿。 */
export async function read_rpgmaker_container(
  content: Uint8Array,
  file: string,
): Promise<ReadonlyMap<string, JSZip.JSZipObject>> {
  const files = await read_zip_members(content, file);
  if (files.size === 0) throw new AppError("file.invalid_structure", { public_details: { file } });
  return files;
}
