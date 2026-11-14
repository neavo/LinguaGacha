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
  type ImagePage,
  type ImageRecord,
  type Quad,
} from "../../../shared/image";
import { AppError } from "../../../shared/error";
import { read_zip_members, validate_zip_member_path } from "../shared/zip-members";
import { read_archive_records } from "../shared/archive-records";
import { write_message_records } from "../shared/message-records";

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

/** 计算单页消字输入指纹：按稳定 regionId 排序，与原文、名称、阅读顺序和书写方向解耦。 */
export function erase_input_digest(page: ImagePage): string {
  const regions = [...page.regions]
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0))
    .map((region) =>
      region.disposition === "preserve"
        ? { regionId: region.regionId, disposition: "preserve" }
        : {
            regionId: region.regionId,
            disposition: "translate",
            textAreas: region.textAreas,
            erase: region.erase
              ? {
                  method: region.erase.method,
                  mask: region.erase.mask,
                  padding: region.erase.padding ?? null,
                  exclusions: region.erase.exclusions,
                }
              : null,
          },
    );
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

/** 校验凸四边形有限、非自交、非零面积，且所有顶点落在规范化原图内。 */
function validate_quad(quad: Quad, width: number, height: number): void {
  for (const point of quad) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > width ||
      point.y < 0 ||
      point.y > height
    ) {
      throw new Error("Quad point outside page bounds");
    }
  }
  let sign = 0;
  let doubledArea = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const c = quad[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= 1e-4) throw new Error("Quad must be strictly convex with non-zero area");
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) sign = currentSign;
    else if (sign !== currentSign) throw new Error("Quad must be convex and non-self-intersecting");
    doubledArea += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(doubledArea) * 0.5 <= 1e-2) throw new Error("Quad area too small");
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
      for (const quad of region.textAreas) validate_quad(quad, page.width, page.height);
      if (region.erase) {
        if (region.erase.padding !== undefined && !Number.isFinite(region.erase.padding))
          throw new Error("Invalid erase padding");
        for (const quad of region.erase.exclusions) validate_quad(quad, page.width, page.height);
      }
      if (region.disposition === "translate") {
        if (region.preserveReason !== undefined)
          throw new Error("Translate region cannot carry preserveReason");
        if (confirmed && (region.direction === null || !region.erase))
          throw new Error("Confirmed translate region requires direction and erase options");
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
          cleanRegion.method !== undefined ||
          cleanRegion.mask !== undefined ||
          cleanRegion.maskSha256 !== undefined
        )
          throw new Error("Invalid clean preserve region");
      } else {
        const expectedMask = `masks/${bookPage.pageId}/${bookRegion.regionId}.png`;
        if (
          cleanRegion.preserveReason !== undefined ||
          cleanRegion.method === undefined ||
          cleanRegion.mask !== expectedMask ||
          validate_zip_member_path(cleanRegion.mask) !== cleanRegion.mask ||
          cleanRegion.maskSha256 === undefined
        )
          throw new Error("Invalid clean translate region");
      }
    }
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
      ...clean.pages.flatMap((p) => p.regions.flatMap((r) => (r.mask ? [r.mask] : []))),
    ]);
    if (members.size !== expected.size || [...members.keys()].some((name) => !expected.has(name)))
      throw new Error("Unexpected image member");
    for (let i = 0; i < book.pages.length; i++) {
      const page = book.pages[i]!;
      const cleanPage = clean.pages[i]!;
      const originalMember = members.get(page.original);
      if (!originalMember) throw new Error("Missing original image");
      const originalBytes = await originalMember.async("uint8array");
      if (image_sha256(originalBytes) !== page.sha256)
        throw new Error("Original image digest mismatch");
      const origMeta = image_metadata(originalBytes);
      if (
        origMeta.width !== page.width ||
        origMeta.height !== page.height ||
        origMeta.orientation !== page.orientation
      )
        throw new Error("Image metadata mismatch");

      const baseMember = members.get(cleanPage.clean);
      if (!baseMember) throw new Error("Missing clean image");
      const baseBytes = await baseMember.async("uint8array");
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
      if (
        basePixels.extension !== ".png" ||
        basePixels.width !== page.width ||
        basePixels.height !== page.height
      )
        throw new Error("Clean image dimensions mismatch");

      const unionMask = new Uint8Array(page.width * page.height);
      for (const region of cleanPage.regions) {
        if (!region.mask) continue;
        const maskMember = members.get(region.mask);
        if (!maskMember) throw new Error("Missing region mask");
        const maskBytes = await maskMember.async("uint8array");
        if (image_sha256(maskBytes) !== region.maskSha256)
          throw new Error("Region mask digest mismatch");
        const maskPixels = await decode_normalized_image_rgb(maskBytes);
        if (
          maskPixels.extension !== ".png" ||
          maskPixels.width !== page.width ||
          maskPixels.height !== page.height
        )
          throw new Error("Region mask dimensions mismatch");
        for (let px = 0; px < unionMask.length; px++) {
          if (unionMask[px]) continue;
          const off = px * 3;
          const luma = Math.round(
            0.299 * maskPixels.rgb[off]! +
              0.587 * maskPixels.rgb[off + 1]! +
              0.114 * maskPixels.rgb[off + 2]!,
          );
          if (luma > 0) unionMask[px] = 1;
        }
      }

      // 统一复用同一 MuPDF 规范化规则，对 PNG 与 JPEG（含 EXIF 方向）执行零容差掩码外一致性检查。
      const origPixels = await decode_normalized_image_rgb(originalBytes);
      if (origPixels.width !== page.width || origPixels.height !== page.height)
        throw new Error("Image metadata mismatch");
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

/** 图片格式只建立工程条目和通用文本写回视图，像素生成和验收由图片 SDK 拥有。 */
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
  /** 通用工程词条写回只输出更新后的 `items.json`，保留第一/二阶段解耦边界。 */
  public async render_text(
    content: Uint8Array,
    items: readonly Item[],
    file: string,
  ): Promise<string> {
    const { records } = await read_image_package(content, file);
    write_message_records(records, items, file);
    return JSON.stringify(records, null, 4);
  }
}
