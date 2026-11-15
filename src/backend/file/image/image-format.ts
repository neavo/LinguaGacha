import { image_metadata } from "./image-metadata";
import { decode_normalized_image_rgb } from "./image-pixels";
import { createHash } from "node:crypto";
import { Compile } from "typebox/compile";
import { create_item, type Item } from "../../../domain/item";
import {
  IMAGE_BOOK_SCHEMA,
  IMAGE_CLEAN_SCHEMA,
  type ImageBook,
  type ImageClean,
  type ImageCleanPage,
  type ImagePage,
  type ImageRecord,
} from "../../../shared/image";
import { AppError } from "../../../shared/error";
import { read_zip_members, validate_zip_member_path } from "../shared/zip-members";
import { read_archive_records } from "../shared/archive-records";
import { write_message_records } from "../shared/message-records";
import { read_translation_for_generation } from "../shared/translation-generation-text";
import type { ImageTextInput } from "../../../shared/image-text";

const IMAGE_STATE_MEMBER = "image.json"; // 归档内保存原稿与确认区域意图的 JSON 成员名。
const IMAGE_CLEAN_MEMBER = "clean.json"; // 归档内保存已验收底图、掩码与摘要的 JSON 成员名。
const IMAGE_LIMITS = Object.freeze({
  members: 30000,
  expandedBytes: 950_000_000,
  memberBytes: 256_000_000,
  pagePixels: 100_000_000,
  jsonBytes: 16_000_000,
}); // 压缩包成员数量、体积与单页像素安全上限。
const BOOK_VALIDATOR = Compile(IMAGE_BOOK_SCHEMA); // 预编译的图片书结构校验器。
const CLEAN_VALIDATOR = Compile(IMAGE_CLEAN_SCHEMA); // 预编译的已验收底图清单校验器。

/** 计算字节或文本的十六进制 SHA-256 摘要。 */
export const image_sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** 来源按归档的待译区域顺序取值，恢复草稿中的保留记录不参与摘要。 */
export function image_text_source_digest(book: ImageBook, records: readonly ImageRecord[]): string {
  const byId = new Map(
    records.map((record) => [JSON.stringify([record.pageId, record.regionId]), record]),
  );
  return image_sha256(
    JSON.stringify({
      version: book.version,
      bookId: book.bookId,
      pages: book.pages.map((page) => ({
        pageId: page.pageId,
        original: page.original,
        sha256: page.sha256,
        width: page.width,
        height: page.height,
        orientation: page.orientation,
        regions: page.regions.map((region) => ({
          regionId: region.regionId,
          disposition: region.disposition,
          preserveReason: region.preserveReason ?? null,
          selection: region.selection
            ? { path: region.selection.path, sha256: region.selection.sha256 }
            : null,
          direction: region.direction,
          fill: region.fill ? { color: region.fill.color } : null,
        })),
      })),
      records: book.pages.flatMap((page) =>
        page.regions
          .filter((region) => region.disposition === "translate")
          .map((region) => {
            const record = byId.get(JSON.stringify([page.pageId, region.regionId]));
            if (!record)
              throw new Error(`Missing image source record: ${page.pageId}/${region.regionId}`);
            return {
              pageId: record.pageId,
              regionId: record.regionId,
              message: record.message,
              name: record.name ?? null,
            };
          }),
      ),
    }),
  );
}

/** 计算单页消字输入指纹：按稳定 regionId 排序，与原文、名称、阅读顺序和书写方向解耦。 */
export function erase_input_digest(page: ImagePage): string {
  const regions = [...page.regions]
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0))
    .map((region) => ({
      regionId: region.regionId,
      disposition: region.disposition,
      selection: region.selection
        ? { path: region.selection.path, sha256: region.selection.sha256 }
        : null,
      ...(region.disposition === "translate"
        ? { fill: region.fill ? { color: region.fill.color } : null }
        : {}),
    }));
  return image_sha256(
    JSON.stringify({
      source: [page.sha256, page.width, page.height, page.orientation],
      regions,
    }),
  );
}

/** 根据确认状态与保留原因计算第一阶段交付状态。 */
export function compute_clean_status(book: ImageBook): "complete" | "partial" {
  for (const page of book.pages) {
    for (const region of page.regions) {
      if (region.disposition === "preserve" && region.preserveReason !== "intentional") {
        return "partial";
      }
    }
  }
  return "complete";
}

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
  const jsonMembers = new Set([IMAGE_STATE_MEMBER, "items.json", IMAGE_CLEAN_MEMBER]);
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
      (jsonMembers.has(key) && size > IMAGE_LIMITS.jsonBytes)
    )
      throw new AppError("file.asset_too_large");
    offset = next;
  }
  if (offset !== end) throw new Error("Invalid ZIP directory size");
}

/** 草稿与归档共用结构边界；`confirmed: true` 时要求全部待消字与原文约束完整。 */
export function validate_image_book(
  value: unknown,
  records: readonly ImageRecord[],
  options: { confirmed?: boolean } = {},
): asserts value is ImageBook {
  const confirmed = options.confirmed ?? true;
  if (!BOOK_VALIDATOR.Check(value)) throw new Error("Invalid image state");
  const pageIds = new Set<string>();
  const translated = new Set<string>();
  const regions = new Set<string>();
  for (const page of value.pages) {
    if (pageIds.has(page.pageId) || page.width * page.height > IMAGE_LIMITS.pagePixels)
      throw new Error("Invalid image page");
    pageIds.add(page.pageId);
    if (
      validate_zip_member_path(page.original) !== page.original ||
      !/^originals\/[^/]+\.(png|jpe?g)$/iu.test(page.original)
    )
      throw new Error("Invalid original path");
    const regionIds = new Set<string>();
    for (const region of page.regions) {
      if (regionIds.has(region.regionId)) throw new Error("Duplicate region");
      regionIds.add(region.regionId);
      const key = page.pageId + "/" + region.regionId;
      regions.add(key);
      if (
        region.selection &&
        region.selection.path !== `masks/${page.pageId}/${region.regionId}.png`
      )
        throw new Error("Invalid selection path");
      if (region.disposition === "translate") {
        if (region.preserveReason !== undefined)
          throw new Error("Translate region cannot carry preserveReason");
        if (confirmed && (region.direction === null || !region.selection || !region.fill))
          throw new Error("Confirmed translate region requires direction, selection and fill");
        translated.add(key);
      } else {
        if (region.preserveReason === undefined)
          throw new Error("Preserve region requires preserveReason");
      }
    }
  }
  const seen = new Map<string, ImageRecord>();
  const pageOrder = new Map(value.pages.map((page, index) => [page.pageId, index]));
  let previousPage = -1;
  for (const record of records) {
    const key = record.pageId + "/" + record.regionId;
    if (
      typeof record.message !== "string" ||
      (record.name !== undefined && typeof record.name !== "string") ||
      !regions.has(key) ||
      seen.has(key)
    )
      throw new Error("Invalid image record reference");
    const order = pageOrder.get(record.pageId)!;
    if (order < previousPage) throw new Error("Image records do not follow page order");
    previousPage = order;
    seen.set(key, record);
  }
  if (confirmed) {
    for (const key of translated) {
      const record = seen.get(key);
      if (!record || record.message.trim().length === 0)
        throw new Error("Confirmed translate region requires non-empty source text");
    }
  }
}

/** 校验 `clean.json` 与 `image.json` 的页序、区域引用、状态、输入指纹与成员路径一致性。 */
export function validate_image_clean(value: unknown, book: ImageBook): asserts value is ImageClean {
  if (!CLEAN_VALIDATOR.Check(value)) throw new Error("Invalid clean manifest");
  if (value.bookId !== book.bookId || value.pages.length !== book.pages.length)
    throw new Error("Clean manifest book mismatch");
  if (value.status !== compute_clean_status(book))
    throw new Error("Clean manifest status does not match book regions");
  for (let i = 0; i < book.pages.length; i++) {
    const bookPage = book.pages[i]!;
    const cleanPage = value.pages[i]!;
    if (cleanPage.pageId !== bookPage.pageId) throw new Error("Clean page order mismatch");
    const expectedClean = `clean/${bookPage.pageId}.png`;
    if (
      validate_zip_member_path(cleanPage.clean) !== cleanPage.clean ||
      cleanPage.clean !== expectedClean
    )
      throw new Error("Invalid clean image path");
    if (cleanPage.inputSha256 !== erase_input_digest(bookPage))
      throw new Error("Clean input digest mismatch");
    if (cleanPage.regions.length !== bookPage.regions.length)
      throw new Error("Clean page regions mismatch");
    const bookRegions = new Map(bookPage.regions.map((region) => [region.regionId, region]));
    const seen = new Set<string>();
    for (const cleanRegion of cleanPage.regions) {
      if (seen.has(cleanRegion.regionId)) throw new Error("Duplicate clean region");
      seen.add(cleanRegion.regionId);
      const bookRegion = bookRegions.get(cleanRegion.regionId);
      if (!bookRegion || cleanRegion.disposition !== bookRegion.disposition)
        throw new Error("Clean region disposition mismatch");
      if (cleanRegion.disposition === "preserve") {
        if (
          cleanRegion.preserveReason !== bookRegion.preserveReason ||
          cleanRegion.mask !== undefined ||
          cleanRegion.maskSha256 !== undefined
        )
          throw new Error("Invalid clean preserve region");
      } else {
        const expectedMask = `masks/${bookPage.pageId}/${bookRegion.regionId}.png`;
        if (
          cleanRegion.preserveReason !== undefined ||
          cleanRegion.mask !== expectedMask ||
          validate_zip_member_path(cleanRegion.mask) !== cleanRegion.mask ||
          cleanRegion.maskSha256 !== bookRegion.selection?.sha256 ||
          cleanRegion.mask !== bookRegion.selection?.path
        )
          throw new Error("Invalid clean translate region");
      }
    }
  }
}

/** 逐个解码输入选区，校验身份、二值性和互斥，返回仅含待填区域的并集。 */
export async function validate_image_selections(
  page: ImagePage,
  read: (member: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const occupied = new Uint8Array(page.width * page.height);
  const union = new Uint8Array(occupied.length);
  for (const region of page.regions) {
    if (!region.selection) continue;
    if (region.selection.path !== `masks/${page.pageId}/${region.regionId}.png`)
      throw new Error("Invalid selection path");
    const bytes = await read(region.selection.path);
    if (image_sha256(bytes) !== region.selection.sha256)
      throw new Error("Region mask digest mismatch");
    if (bytes[24] !== 8 || bytes[25] !== 0)
      throw new Error("Region mask must be an 8-bit grayscale PNG");
    const meta = image_metadata(bytes);
    if (
      meta.extension !== ".png" ||
      meta.orientation !== 1 ||
      meta.width !== page.width ||
      meta.height !== page.height
    )
      throw new Error("Region mask dimensions mismatch");
    const mask = await decode_normalized_image_rgb(bytes);
    let nonempty = false;
    for (let px = 0; px < occupied.length; px++) {
      const off = px * 3;
      const value = mask.rgb[off]!;
      if (
        (value !== 0 && value !== 255) ||
        mask.rgb[off + 1] !== value ||
        mask.rgb[off + 2] !== value
      )
        throw new Error("Region mask must be binary");
      if (!value) continue;
      if (occupied[px]) throw new Error("Region selections overlap");
      occupied[px] = 1;
      nonempty = true;
      if (region.disposition === "translate") union[px] = 1;
    }
    if (!nonempty) throw new Error("Region selection is empty");
  }
  return union;
}

/** 归档读取和离线恢复共用像素完整性边界。 */
export async function validate_image_page_pixels(
  page: ImagePage,
  cleanPage: Pick<ImageCleanPage, "clean" | "cleanSha256">,
  read: (member: string) => Promise<Uint8Array>,
): Promise<void> {
  const originalBytes = await read(page.original);
  if (image_sha256(originalBytes) !== page.sha256)
    throw new Error("Original image digest mismatch");
  const origMeta = image_metadata(originalBytes);
  if (
    origMeta.width !== page.width ||
    origMeta.height !== page.height ||
    origMeta.orientation !== page.orientation
  )
    throw new Error("Image metadata mismatch");

  const baseBytes = await read(cleanPage.clean);
  if (image_sha256(baseBytes) !== cleanPage.cleanSha256)
    throw new Error("Clean image digest mismatch");
  const baseMeta = image_metadata(baseBytes);
  if (
    baseMeta.extension !== ".png" ||
    baseMeta.width !== page.width ||
    baseMeta.height !== page.height
  )
    throw new Error("Clean image dimensions mismatch");
  const basePixels = await decode_normalized_image_rgb(baseBytes);

  const unionMask = await validate_image_selections(page, read);

  // 统一复用同一 MuPDF 规范化规则，对 PNG 与 JPEG（含 EXIF 方向）执行零容差掩码外一致性检查。
  const origPixels = await decode_normalized_image_rgb(originalBytes);
  for (let px = 0; px < unionMask.length; px++) {
    if (unionMask[px]) continue;
    const off = px * 3;
    if (
      basePixels.rgb[off] !== origPixels.rgb[off] ||
      basePixels.rgb[off + 1] !== origPixels.rgb[off + 1] ||
      basePixels.rgb[off + 2] !== origPixels.rgb[off + 2]
    )
      throw new Error("Pixels changed outside masks");
  }
}

/** 读取并全面校验 `.image` 归档，逐页校验成员白名单、摘要、尺寸、EXIF 方向与掩码外像素一致性。 */
export async function read_image_package(content: Uint8Array, file: string) {
  try {
    validate_directory(content);
    const members = await read_zip_members(content, file);
    const stateMember = members.get(IMAGE_STATE_MEMBER);
    const cleanMember = members.get(IMAGE_CLEAN_MEMBER);
    if (!stateMember || !cleanMember) throw new Error("Missing image.json or clean.json");
    const book: unknown = JSON.parse(await stateMember.async("string"));
    const records = (await read_archive_records(members)) as ImageRecord[];
    const clean: unknown = JSON.parse(await cleanMember.async("string"));
    validate_image_book(book, records, { confirmed: true });
    validate_image_clean(clean, book);
    const expected = new Set<string>([
      "items.json",
      IMAGE_STATE_MEMBER,
      IMAGE_CLEAN_MEMBER,
      ...book.pages.map((p) => p.original),
      ...clean.pages.map((p) => p.clean),
      ...book.pages.flatMap((p) =>
        p.regions.flatMap((r) => (r.selection ? [r.selection.path] : [])),
      ),
    ]);
    if (members.size !== expected.size || [...members.keys()].some((name) => !expected.has(name)))
      throw new Error("Unexpected image member");
    for (let i = 0; i < book.pages.length; i++) {
      const page = book.pages[i]!;
      const cleanPage = clean.pages[i]!;
      await validate_image_page_pixels(page, cleanPage, async (member) => {
        const entry = members.get(member);
        if (!entry) throw new Error("Missing image member");
        return entry.async("uint8array");
      });
    }
    return { book, records, clean };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "file.asset_too_large") throw cause;
    throw new AppError("file.invalid_structure", { cause, public_details: { file } });
  }
}

/** 身份映射只解释包，项目域决定是否复制已完成事实，与底图重新生成无关。 */
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

/** 图片格式建立工程条目与文本快照，像素生成和验收由图片 SDK 拥有。 */
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
  /** 生成服务已复用重复项；这里只校验行身份并保留有效译文状态。 */
  public async render_text(
    content: Uint8Array,
    items: readonly Item[],
    file: string,
  ): Promise<string> {
    const { book, records } = await read_image_package(content, file);
    const sourceSha256 = image_text_source_digest(book, records);
    write_message_records(records, items, file); // 来源摘要已固定，后续只取区域身份。
    const byRow = new Map(items.map((item) => [item.row, item]));
    const translated = new Set(
      book.pages.flatMap((page) =>
        page.regions
          .filter((region) => region.disposition === "translate")
          .map((region) => JSON.stringify([page.pageId, region.regionId])),
      ),
    );
    const input: ImageTextInput = {
      version: 1,
      bookId: book.bookId,
      sourceSha256,
      records: records.flatMap((record, row) => {
        if (!translated.has(JSON.stringify([record.pageId, record.regionId]))) return [];
        const item = byRow.get(row);
        return [
          {
            pageId: record.pageId,
            regionId: record.regionId,
            text: item ? (read_translation_for_generation(item) ?? null) : null,
          },
        ];
      }),
    };
    return JSON.stringify(input, null, 4);
  }
}
