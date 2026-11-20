import path from "node:path";

import {
  image_layout_area_path,
  read_image_book,
  read_image_records,
  type ImageBook,
} from "../../../shared/image-package";
import { AppError } from "../../../shared/error";
import { default_native_fs as fs } from "../../../native/native-fs";
import { PACKAGE_ITEMS_MEMBER, read_package_items } from "../shared/package-items";
import { read_zip_members } from "../shared/zip-members";

export const IMAGE_STATE_MEMBER = "image.json"; // 编辑与归档共用同一个清单成员。

/** 入库时核对成员集合，已入库资产只读取清单。 */
export async function read_image_package(
  content: Uint8Array,
  file: string,
  { stored = false }: { stored?: boolean } = {},
) {
  const members = await read_zip_members(content, file);
  try {
    const stateMember = members.get(IMAGE_STATE_MEMBER);
    if (!stateMember) throw new Error("Missing image.json");
    const records = read_image_records(await read_package_items(members));
    const book = read_image_book(JSON.parse(await stateMember.async("string")), records);
    if (!stored) validate_image_members(book, members.keys());
    return { book, records };
  } catch (cause) {
    throw new AppError("file.invalid_structure", { cause, public_details: { file } });
  }
}

/** 读取工作目录的两份清单，核对区域与条目的关系。 */
export function read_image_package_manifest(directory: string) {
  const records = read_image_records(read_json(path.join(directory, PACKAGE_ITEMS_MEMBER)));
  const book = read_image_book(read_json(path.join(directory, IMAGE_STATE_MEMBER)), records);
  return { book, records };
}

/** 核对声明成员齐全，包内只保存清单引用的文件。 */
function validate_image_members(book: ImageBook, actualMembers: Iterable<string>): void {
  const expected = new Set([PACKAGE_ITEMS_MEMBER, IMAGE_STATE_MEMBER]);
  for (const { pageId, original, regions } of book.pages) {
    expected.add(original);
    for (const { regionId, parts, patch } of regions) {
      if (!parts) expected.add(image_layout_area_path(pageId, regionId));
      if (patch) expected.add(patch.path).add(patch.mask);
    }
  }
  for (const name of actualMembers)
    if (!expected.delete(name)) throw new Error(`Unexpected image member: ${name}`);
  const [missing] = expected;
  if (missing) throw new Error(`Missing image member: ${missing}`);
}

/** 当前 JSON 使用 UTF-8，解析错误由调用边界归类。 */
function read_json(file: string): unknown {
  return JSON.parse(fs.read_text_file(file));
}
