import { image_metadata } from "./image-metadata";
import { createHash } from "node:crypto";
import { Compile } from "typebox/compile";
import { create_item, type Item } from "../../../domain/item";
import {
  IMAGE_BOOK_SCHEMA,
  type ImageBook,
  type ImageRecord,
  type ImageGenerationSnapshot,
  type ImageWriteback,
} from "../../../shared/image";
import { AppError } from "../../../shared/error";
import { read_zip_members, validate_zip_member_path } from "../shared/zip-members";
import { read_archive_records } from "../shared/archive-records";
import { write_message_records } from "../shared/message-records";

export const IMAGE_STATE_MEMBER = "image.json";
export const IMAGE_WRITEBACK_MEMBER = "image-writeback.json";
export const IMAGE_LIMITS = Object.freeze({
  members: 30000,
  expandedBytes: 950_000_000,
  memberBytes: 256_000_000,
  pagePixels: 100_000_000,
  jsonBytes: 16_000_000,
});
const VALIDATOR = Compile(IMAGE_BOOK_SCHEMA);
export const image_sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** 原中央目录先查重复与预算，避免 JSZip 覆盖同名成员后丢失证据。 */
function validate_directory(content: Uint8Array): void {
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
  let offset = bytes.readUInt32LE(end + 16),
    total = 0;
  if (
    count > IMAGE_LIMITS.members ||
    count !== bytes.readUInt16LE(end + 8) ||
    offset + bytes.readUInt32LE(end + 12) !== end
  )
    throw new Error("Unsupported ZIP directory");
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid ZIP entry");
    const size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28);
    const next =
      offset + 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > end || (bytes.readUInt16LE(offset + 8) & 1) !== 0)
      throw new Error("Unsupported ZIP entry");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + length),
    );
    const key = validate_zip_member_path(name.replace(/\/$/u, "")).toLowerCase();
    if (names.has(key)) throw new Error("Duplicate ZIP entry");
    names.add(key);
    total += size;
    if (
      size > IMAGE_LIMITS.memberBytes ||
      total > IMAGE_LIMITS.expandedBytes ||
      ((name === IMAGE_STATE_MEMBER || name === "items.json") && size > IMAGE_LIMITS.jsonBytes)
    )
      throw new AppError("file.asset_too_large");
    offset = next;
  }
  if (offset !== end) throw new Error("Invalid ZIP directory size");
}

/** 草稿与归档共用结构边界，内部像素步骤消费已验证状态。 */
export function validate_image_book(
  value: unknown,
  records: readonly ImageRecord[],
): asserts value is ImageBook {
  if (!VALIDATOR.Check(value)) throw new Error("Invalid image state");
  const ids = new Set<string>();
  const translated = new Set<string>();
  for (const page of value.pages) {
    if (ids.has(page.pageId) || page.width * page.height > IMAGE_LIMITS.pagePixels)
      throw new Error("Invalid image page");
    ids.add(page.pageId);
    if (
      validate_zip_member_path(page.original) !== page.original ||
      !/^originals\/[^/]+\.(png|jpe?g)$/iu.test(page.original)
    )
      throw new Error("Invalid original path");
    const regionIds = new Set<string>();
    const checkPolygon = (polygon: { x: number; y: number }[]) => {
      if (
        polygon.some(
          (p) =>
            !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x > page.width || p.y > page.height,
        )
      )
        throw new Error("Geometry outside image");
      const area = polygon.reduce((sum, p, i) => {
        const q = polygon[(i + 1) % polygon.length]!;
        return sum + p.x * q.y - q.x * p.y;
      }, 0);
      if (Math.abs(area) < 1) throw new Error("Empty polygon");
    };
    for (const region of page.regions) {
      if (regionIds.has(region.regionId)) throw new Error("Duplicate region");
      regionIds.add(region.regionId);
      if (region.disposition === "translate") {
        translated.add(page.pageId + "/" + region.regionId);
        if (!region.layout.length) throw new Error("Missing layout");
      }
      for (const rect of region.source)
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.x + rect.width > page.width ||
          rect.y + rect.height > page.height
        )
          throw new Error("Invalid source geometry");
      region.layout.forEach(checkPolygon);
    }
    const grouped = new Set<string>(),
      groupIds = new Set<string>();
    for (const group of page.groups) {
      if (groupIds.has(group.groupId)) throw new Error("Duplicate group");
      groupIds.add(group.groupId);
      for (const id of group.regionIds) {
        if (!regionIds.has(id) || grouped.has(id)) throw new Error("Invalid group membership");
        grouped.add(id);
      }
      if (
        group.mask &&
        (validate_zip_member_path(group.mask.path) !== group.mask.path ||
          !/^masks\/[^/]+\.png$/u.test(group.mask.path))
      )
        throw new Error("Invalid mask path");
      if (group.mode !== "preserve" && !group.areas.length && !group.mask)
        throw new Error("Missing edit area");
      [...group.areas, ...group.protection].forEach(checkPolygon);
    }
    if (page.regions.some((r) => r.disposition === "translate" && !grouped.has(r.regionId)))
      throw new Error("Ungrouped translation region");
  }
  const seen = new Set<string>();
  const pageOrder = new Map(value.pages.map((page, index) => [page.pageId, index]));
  let previousPage = -1;
  for (const record of records) {
    const key = record.pageId + "/" + record.regionId;
    if (
      typeof record.message !== "string" ||
      (record.name !== undefined && typeof record.name !== "string") ||
      !translated.has(key) ||
      seen.has(key)
    )
      throw new Error("Invalid image record reference");
    const order = pageOrder.get(record.pageId)!;
    if (order < previousPage) throw new Error("Image records do not follow page order");
    previousPage = order;
    seen.add(key);
  }
  if (seen.size !== translated.size) throw new Error("Missing image records");
}

export async function read_image_package(content: Uint8Array, file: string) {
  try {
    validate_directory(content);
    const members = await read_zip_members(content, file);
    const state = members.get(IMAGE_STATE_MEMBER);
    if (!state) throw new Error("Missing image state");
    const book: unknown = JSON.parse(await state.async("string"));
    const records = (await read_archive_records(members)) as ImageRecord[];
    validate_image_book(book, records);
    const expected = new Set([
      "items.json",
      IMAGE_STATE_MEMBER,
      ...book.pages.map((p) => p.original),
      ...book.pages.flatMap((page) =>
        page.groups.flatMap((group) => (group.mask ? [group.mask.path] : [])),
      ),
    ]);
    if (members.size !== expected.size || [...members.keys()].some((name) => !expected.has(name)))
      throw new Error("Unexpected image member");
    for (const page of book.pages) {
      const member = members.get(page.original);
      if (!member) throw new Error("Missing original image");
      const bytes = await member.async("uint8array");
      if (image_sha256(bytes) !== page.sha256) throw new Error("Original image digest mismatch");
      const metadata = image_metadata(bytes);
      if (
        metadata.width !== page.width ||
        metadata.height !== page.height ||
        metadata.orientation !== page.orientation
      )
        throw new Error("Image metadata mismatch");
      for (const group of page.groups)
        if (group.mask) {
          const mask = members.get(group.mask.path);
          if (!mask) throw new Error("Missing image mask");
          const bytes = await mask.async("uint8array"),
            metadata = image_metadata(bytes);
          if (
            image_sha256(bytes) !== group.mask.sha256 ||
            metadata.width !== page.width ||
            metadata.height !== page.height ||
            metadata.orientation !== 1
          )
            throw new Error("Image mask mismatch");
        }
    }
    return { book, records, members };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "file.asset_too_large") throw cause;
    throw new AppError("file.invalid_structure", { cause, public_details: { file } });
  }
}

/** 身份映射只解释包，项目域决定是否复制已完成事实。 */
export function image_record_identities(book: ImageBook, records: readonly ImageRecord[]) {
  const pages = new Map(book.pages.map((page) => [page.pageId, page]));
  return new Map(
    records.map((record, row) => {
      const page = pages.get(record.pageId)!;
      return [
        book.bookId + "/" + record.pageId + "/" + record.regionId,
        {
          row,
          source: record.message,
          name: record.name ?? "",
          image: [page.sha256, page.orientation, page.width, page.height].join(":"),
        },
      ];
    }),
  );
}

/** 图片格式只建立工程条目和写回快照，像素执行由图片 SDK 拥有。 */
export class ImageFormat {
  /** 一次读取同时交付条目和已验证身份，替换流程复用这份解析结果。 */
  public async read(content: Uint8Array, file: string) {
    const { book, records } = await read_image_package(content, file);
    return {
      items: records.map((record, row) =>
        create_item({
          src: record.message,
          name_src: record.name ?? null,
          row,
          file_type: "IMAGE",
          file_path: file,
        }),
      ),
      image: { book, records },
    };
  }
  /** 完成清单与文本共用生成条目，空译文保持明确完成的语义。 */
  public async render(
    content: Uint8Array,
    items: readonly Item[],
    file: string,
    snapshot: ImageGenerationSnapshot,
  ): Promise<{ text: string; manifest: ImageWriteback }> {
    const { book, records } = await read_image_package(content, file);
    const stateSha256 = image_sha256(JSON.stringify({ book, records }));
    const completed = new Map(items.map((item) => [item.row, item.status === "PROCESSED"]));
    write_message_records(records, items, file);
    const text = JSON.stringify(records, null, 4);
    return {
      text,
      manifest: {
        ...snapshot,
        version: 1,
        assetPath: file,
        sourceSha256: image_sha256(content),
        stateSha256,
        itemsSha256: image_sha256(text),
        rows: records.map((record, row) => ({
          row,
          pageId: record.pageId,
          regionId: record.regionId,
          completed: completed.get(row) ?? false,
        })),
      },
    };
  }
}
