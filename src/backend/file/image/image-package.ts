import path from "node:path";

import {
  read_image_book,
  read_image_records,
  type ImageBook,
  type ImagePage,
  type ImageRecord,
} from "../../../shared/image-package";
import { AppError } from "../../../shared/error";
import { default_native_fs as fs } from "../../../native/native-fs";
import { PACKAGE_ITEMS_MEMBER, read_package_items } from "../shared/package-items";
import { read_zip_members } from "../shared/zip-members";
import { image_metadata } from "./image-metadata";

const IMAGE_STATE_MEMBER = "image.json";
const MEMBER_ERROR_SAMPLE_SIZE = 5; // 成员不一致时只展示少量路径。
const IMAGE_LIMITS = Object.freeze({
  members: 30000,
  expandedBytes: 950_000_000,
  memberBytes: 256_000_000,
  jsonBytes: 16_000_000,
}); // 图片包可能很大，解压前限制声明体积。

/** 导入核对成员像素，读取已入库原稿时直接复用导入结果。 */
export async function read_image_package(
  content: Uint8Array,
  file: string,
  options: { validatePixels?: boolean } = {},
) {
  try {
    validate_zip_budget(content);
    const members = await read_zip_members(content, file);
    const stateMember = members.get(IMAGE_STATE_MEMBER);
    if (!stateMember) throw new Error("Missing image.json");
    const records = read_image_records(await read_package_items(members));
    const book = read_image_book(JSON.parse(await stateMember.async("string")), records);
    await validate_image_members(
      book,
      members.keys(),
      options.validatePixels === false
        ? undefined
        : (member) => members.get(member)!.async("uint8array"),
    );
    return { book, records };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "file.asset_too_large") throw cause;
    throw new AppError("file.invalid_structure", { cause, public_details: { file } });
  }
}

/** 读取工作目录的两份清单，核对区域与条目的关系。 */
export function read_image_package_manifest(directory: string) {
  const records = read_image_records(read_json(path.join(directory, PACKAGE_ITEMS_MEMBER)));
  const book = read_image_book(read_json(path.join(directory, IMAGE_STATE_MEMBER)), records);
  return { book, records };
}

/** 封包需要物理契约，局部补做只需定位并复用已有成员。 */
export async function validate_image_package_directory(
  directory: string,
  { validatePixels = true } = {},
): Promise<{
  book: ImageBook;
  records: ImageRecord[];
}> {
  directory = path.resolve(directory);
  const { book, records } = read_image_package_manifest(directory);
  const members = collect_directory_members(directory);
  await validate_image_members(
    book,
    members,
    validatePixels ? async (member) => fs.read_file(path.join(directory, member)) : undefined,
  );
  return { book, records };
}

/** 结构读取器已确认引用关系，这里只核对成员全集与像素事实。 */
async function validate_image_members(
  book: ImageBook,
  actualMembers: Iterable<string>,
  read?: (member: string) => Promise<Uint8Array>,
): Promise<void> {
  const expected = new Set<string>([
    PACKAGE_ITEMS_MEMBER,
    IMAGE_STATE_MEMBER,
    ...book.pages.flatMap((page) => [
      page.original,
      ...page.regions.flatMap(({ patch }) => (patch ? [patch.path] : [])),
    ]),
  ]);
  const actual = new Set(actualMembers);
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  if (missing.length || extra.length)
    throw new Error(
      `Image members mismatch: missing ${missing.length} ${JSON.stringify(missing.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}; extra ${extra.length} ${JSON.stringify(extra.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}`,
    );
  if (read) for (const page of book.pages) await validate_image_page_members(page, read);
}

/** 原图和局部消字补丁必须与声明的尺寸一致。 */
async function validate_image_page_members(
  page: ImagePage,
  read: (member: string) => Promise<Uint8Array>,
): Promise<void> {
  const original = image_metadata(await read(page.original));
  if (
    original.width !== page.width ||
    original.height !== page.height ||
    original.orientation !== page.orientation
  )
    throw new Error("Image metadata mismatch");
  for (const { patch } of page.regions) {
    if (!patch) continue;
    const bytes = await read(patch.path);
    const metadata = image_metadata(bytes);
    const [, , width, height] = patch.box;
    if (
      metadata.extension !== ".png" ||
      metadata.width !== width ||
      metadata.height !== height ||
      metadata.orientation !== 1 ||
      bytes[24] !== 8 ||
      bytes[25] !== 6
    )
      throw new Error("Image patch must be an 8-bit RGBA PNG matching its box");
    const mupdf = await import("mupdf");
    const image = new mupdf.Image(bytes);
    try {
      const pixels = image.toPixmap();
      try {
        if (pixels.getWidth() !== width || pixels.getHeight() !== height || !pixels.getAlpha())
          throw new Error("Invalid decoded image patch");
        const data = pixels.getPixels();
        const components = pixels.getNumberOfComponents();
        for (let offset = components - 1; offset < data.length; offset += components)
          if (data[offset] !== 0 && data[offset] !== 255)
            throw new Error("Image patch alpha must be binary");
      } finally {
        pixels.destroy();
      }
    } finally {
      image.destroy();
    }
  }
}

/** 原中央目录只检查图片包仍需要的展开预算。 */
function validate_zip_budget(content: Uint8Array): void {
  const bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (
      bytes.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
    )
      break;
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0)
    throw new Error("Invalid ZIP directory");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  let total = 0;
  if (
    count > IMAGE_LIMITS.members ||
    count !== bytes.readUInt16LE(end + 8) ||
    offset + bytes.readUInt32LE(end + 12) !== end
  )
    throw new Error("Unsupported ZIP directory");
  const jsonMembers = new Set([IMAGE_STATE_MEMBER, PACKAGE_ITEMS_MEMBER]);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid ZIP entry");
    const size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28);
    const next =
      offset + 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > end) throw new Error("Unsupported ZIP entry");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + length),
    );
    total += size;
    if (
      size > IMAGE_LIMITS.memberBytes ||
      total > IMAGE_LIMITS.expandedBytes ||
      (jsonMembers.has(name.replace(/\/$/u, "").toLowerCase()) && size > IMAGE_LIMITS.jsonBytes)
    )
      throw new AppError("file.asset_too_large");
    offset = next;
  }
  if (offset !== end) throw new Error("Invalid ZIP directory size");
}

/** 目录校验与封包共用规范成员路径，不跟随链接。 */
function collect_directory_members(root: string, directory = root): string[] {
  const members: string[] = [];
  for (const entry of fs.read_dirents(directory)) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) members.push(...collect_directory_members(root, file));
    else if (entry.isFile()) members.push(path.relative(root, file).split(path.sep).join("/"));
    else throw new Error(`Unsupported image package member: ${entry.name}`);
  }
  return members;
}

/** 当前 JSON 使用 UTF-8，解析错误由调用边界归类。 */
function read_json(file: string): unknown {
  return JSON.parse(fs.read_text_file(file));
}
