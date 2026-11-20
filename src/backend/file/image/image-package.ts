import path from "node:path";
import { inflateSync } from "node:zlib";

import {
  image_layout_area_path,
  read_image_book,
  read_image_records,
  type ImageBook,
  type ImagePage,
} from "../../../shared/image-package";
import { AppError } from "../../../shared/error";
import { default_native_fs as fs } from "../../../native/native-fs";
import { PACKAGE_ITEMS_MEMBER, read_package_items } from "../shared/package-items";
import { read_zip_members } from "../shared/zip-members";
import { image_metadata, read_png_chunks, read_png_header } from "./image-metadata";

export const IMAGE_STATE_MEMBER = "image.json"; // 编辑与归档共用同一个清单成员。
const MEMBER_ERROR_SAMPLE_SIZE = 5; // 成员不一致时只展示少量路径。
const PNG_FILTER = Object.freeze({ none: 0, sub: 1, up: 2, average: 3, paeth: 4 });
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
  { stored = false }: { stored?: boolean } = {},
) {
  try {
    if (!stored) validate_zip_budget(content);
    const members = await read_zip_members(content, file);
    const stateMember = members.get(IMAGE_STATE_MEMBER);
    if (!stateMember) throw new Error("Missing image.json");
    const records = read_image_records(await read_package_items(members));
    const book = read_image_book(JSON.parse(await stateMember.async("string")), records);
    if (!stored) {
      validate_image_members(book, members.keys());
      for (const page of book.pages)
        await validate_image_page_members(page, (name) => members.get(name)!.async("uint8array"));
    }
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

/** 先核对成员全集，使像素校验只读取清单声明的成员。 */
function validate_image_members(book: ImageBook, actualMembers: Iterable<string>): void {
  const expected = new Set<string>([
    PACKAGE_ITEMS_MEMBER,
    IMAGE_STATE_MEMBER,
    ...book.pages.flatMap((page) => [
      page.original,
      ...page.regions.flatMap(({ regionId, parts, patch }) => [
        ...(parts ? [] : [image_layout_area_path(page.pageId, regionId)]),
        ...(patch ? [patch.path] : []),
      ]),
    ]),
  ]);
  const actual = new Set(actualMembers);
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  if (missing.length || extra.length)
    throw new Error(
      `Image members mismatch: missing ${missing.length} ${JSON.stringify(missing.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}; extra ${extra.length} ${JSON.stringify(extra.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}`,
    );
}

/** 核对原图与像素成员各自的坐标尺寸。 */
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
  for (const { regionId, box, parts, patch } of page.regions) {
    if (!parts) {
      const bytes = await read(image_layout_area_path(page.pageId, regionId));
      validate_binary_pixels(bytes, box[2], box[3], "layout area");
    }
    if (patch)
      validate_binary_pixels(await read(patch.path), patch.box[2], patch.box[3], "patch alpha");
  }
}

/** 掩码取灰度，补丁取 alpha。两者都只允许二值。 */
function validate_binary_pixels(
  content: Uint8Array,
  width: number,
  height: number,
  channel: "layout area" | "patch alpha",
): void {
  const alpha = channel === "patch alpha";
  const bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  const png = read_png_header(bytes);
  const color_type = alpha ? 6 : 0; // PNG 颜色类型为 RGBA 或灰度。
  if (png?.color_type !== color_type || png.width !== width || png.height !== height)
    throw new Error(
      alpha
        ? "Image patch must be an 8-bit RGBA PNG matching its box"
        : "Image layout area must be an 8-bit grayscale PNG matching its box",
    );
  // PNG 的压缩、滤波与隔行字段分别位于 IHDR 的最后三个字节。
  if (bytes[26] || bytes[27] || bytes[28]) throw new Error("Unsupported PNG header");

  const components = alpha ? 4 : 1;
  const scanline_length = 1 + width * components; // 每行以滤波类型开头。
  const expected = scanline_length * height; // 清单已限制页面像素数和区域尺寸。
  const raw = inflateSync(collect_png_idat(bytes), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error("Invalid PNG scanline length");

  let nonempty = false;
  for (let row_start = 0; row_start < raw.length; row_start += scanline_length) {
    const filter = raw[row_start]!;
    if (filter > PNG_FILTER.paeth) throw new Error("Unsupported PNG filter");
    const first = row_start + components; // 跳过滤波字节，取像素末通道。
    const end = row_start + scanline_length;
    // PNG 预测只读取同一通道。原地还原灰度或 alpha，补丁的 RGB 无需解码。
    for (let index = first; index < end; index += components) {
      if (filter !== PNG_FILTER.none) {
        const left = index > first ? raw[index - components]! : 0;
        const above = row_start > 0 ? raw[index - scanline_length]! : 0;
        let predictor: number;
        switch (filter) {
          case PNG_FILTER.sub:
            predictor = left;
            break;
          case PNG_FILTER.up:
            predictor = above;
            break;
          case PNG_FILTER.average:
            predictor = (left + above) >> 1;
            break;
          default: {
            const upper_left =
              row_start > 0 && index > first ? raw[index - scanline_length - components]! : 0;
            predictor = paeth(left, above, upper_left);
          }
        }
        raw[index] = (raw[index]! + predictor) & 0xff;
      }
      if (raw[index] === 255) nonempty = true;
      else if (raw[index] !== 0) throw new Error(`Image ${channel} must be binary`);
    }
  }
  if (!alpha && !nonempty) throw new Error("Image layout area is empty");
}

/** IDAT 必须连续，所有分片共同组成一个 zlib 流。 */
function collect_png_idat(bytes: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let previous_type: string | undefined;
  for (const { type, data } of read_png_chunks(bytes)) {
    if (type === "IDAT") {
      if (chunks.length && previous_type !== "IDAT") throw new Error("Nonconsecutive PNG IDAT");
      chunks.push(data);
    } else if (type === "IEND") {
      if (data.length !== 0) throw new Error("Invalid PNG IEND");
      if (chunks.length > 0) return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
      break;
    }
    previous_type = type;
  }
  throw new Error("Incomplete PNG data");
}

/** Paeth 同距时依次优先取左侧、上方、左上。 */
function paeth(left: number, above: number, upper_left: number): number {
  const estimate = left + above - upper_left;
  const left_distance = Math.abs(estimate - left);
  const above_distance = Math.abs(estimate - above);
  const upper_left_distance = Math.abs(estimate - upper_left);
  if (left_distance <= above_distance && left_distance <= upper_left_distance) return left;
  return above_distance <= upper_left_distance ? above : upper_left;
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

/** 当前 JSON 使用 UTF-8，解析错误由调用边界归类。 */
function read_json(file: string): unknown {
  return JSON.parse(fs.read_text_file(file));
}
