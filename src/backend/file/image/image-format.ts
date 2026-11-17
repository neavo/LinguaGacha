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
  type ImageRegion,
} from "../../../shared/image";
import { AppError } from "../../../shared/error";
import { read_zip_members, validate_zip_member_path } from "../shared/zip-members";
import { read_archive_records } from "../shared/archive-records";
import { write_message_records } from "../shared/message-records";
import { read_translation_for_generation } from "../shared/translation-generation-text";
import type { ImageTextInput } from "../../../shared/image-text";

const IMAGE_STATE_MEMBER = "image.json"; // 归档内保存原稿与区域事实的 JSON 成员名。
const IMAGE_CLEAN_MEMBER = "clean.json"; // 归档内保存自动底图与消字掩码的 JSON 成员名。
const MEMBER_ERROR_SAMPLE_SIZE = 5; // 诊断保留总数与少量路径，避免损坏归档淹没工具回执。
const IMAGE_LIMITS = Object.freeze({
  members: 30000,
  expandedBytes: 950_000_000,
  memberBytes: 256_000_000,
  pagePixels: 100_000_000,
  jsonBytes: 16_000_000,
}); // 压缩包成员数量、体积与单页像素安全上限。
const BOOK_VALIDATOR = Compile(IMAGE_BOOK_SCHEMA); // 预编译的图片书结构校验器。
const CLEAN_VALIDATOR = Compile(IMAGE_CLEAN_SCHEMA); // 预编译的自动底图清单校验器。

/** 计算字节或文本的十六进制 SHA-256 摘要。 */
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

/** 图片归档结构边界：每个有效 OCR 框恰好属于一个区域，每个区域恰好有一条原文。 */
export function validate_image_book(
  value: unknown,
  records: readonly ImageRecord[],
): asserts value is ImageBook {
  if (!BOOK_VALIDATOR.Check(value)) throw new Error("Invalid image state");
  const pageIds = new Set<string>();
  const relativePaths = new Set<string>();
  const regions = new Set<string>();
  for (const page of value.pages) {
    if (pageIds.has(page.pageId) || page.width * page.height > IMAGE_LIMITS.pagePixels)
      throw new Error("Invalid image page");
    pageIds.add(page.pageId);
    const relativePath = validate_zip_member_path(page.relativePath);
    const relativeKey = relativePath.toLocaleLowerCase("en-US");
    if (
      relativePath !== page.relativePath ||
      !/\.(png|jpe?g)$/iu.test(relativePath) ||
      relativePaths.has(relativeKey)
    )
      throw new Error("Invalid or duplicate image relative path");
    relativePaths.add(relativeKey);
    const textBoxIds = new Set<string>();
    for (const textBox of page.textBoxes) {
      if (textBoxIds.has(textBox.textBoxId)) throw new Error("Duplicate image text box");
      textBoxIds.add(textBox.textBoxId);
    }
    const assignedTextBoxIds = new Set<string>();
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
      if (region.layoutArea.path !== `layout-areas/${page.pageId}/${region.regionId}.png`)
        throw new Error("Invalid layout area path");
      const localTextBoxIds = new Set<string>();
      for (const textBoxId of region.textBoxIds) {
        if (
          !textBoxIds.has(textBoxId) ||
          localTextBoxIds.has(textBoxId) ||
          assignedTextBoxIds.has(textBoxId)
        )
          throw new Error("Invalid or duplicate region text box");
        localTextBoxIds.add(textBoxId);
        assignedTextBoxIds.add(textBoxId);
      }
    }
    if (assignedTextBoxIds.size !== textBoxIds.size)
      throw new Error("Every detected text box must belong to one region");
  }
  const seen = new Map<string, ImageRecord>();
  const pageOrder = new Map(value.pages.map((page, index) => [page.pageId, index]));
  let previousPage = -1;
  for (const record of records) {
    const key = record.pageId + "/" + record.regionId;
    if (typeof record.message !== "string" || !regions.has(key) || seen.has(key))
      throw new Error("Invalid image record reference");
    const order = pageOrder.get(record.pageId)!;
    if (order < previousPage) throw new Error("Image records do not follow page order");
    previousPage = order;
    seen.set(key, record);
  }
  for (const key of regions) {
    const record = seen.get(key);
    if (!record || record.message.trim().length === 0)
      throw new Error("Image region requires non-empty source text");
  }
}

/** 校验 `clean.json` 与 `image.json` 的页序、区域顺序、状态与成员路径一致性。 */
export function validate_image_clean(value: unknown, book: ImageBook): asserts value is ImageClean {
  if (!CLEAN_VALIDATOR.Check(value)) throw new Error("Invalid clean manifest");
  if (value.bookId !== book.bookId || value.pages.length !== book.pages.length)
    throw new Error("Clean manifest book mismatch");
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
    if (cleanPage.regions.length !== bookPage.regions.length)
      throw new Error("Clean page regions mismatch");
    for (let regionIndex = 0; regionIndex < bookPage.regions.length; regionIndex++) {
      const bookRegion = bookPage.regions[regionIndex]!;
      const cleanRegion = cleanPage.regions[regionIndex]!;
      if (cleanRegion.regionId !== bookRegion.regionId)
        throw new Error("Clean region order mismatch");
      if (cleanRegion.status === "failed") {
        if (cleanRegion.eraseMask !== undefined) throw new Error("Invalid failed clean region");
      } else {
        const expectedMask = `erase-masks/${bookPage.pageId}/${bookRegion.regionId}.png`;
        if (
          !cleanRegion.eraseMask ||
          cleanRegion.eraseMask !== expectedMask ||
          validate_zip_member_path(cleanRegion.eraseMask) !== cleanRegion.eraseMask
        )
          throw new Error("Invalid cleaned region");
      }
    }
  }
}

/** 排版区域与消字产物共用同一二值图解码边界，路径归属由调用方校验。 */
async function read_image_mask(
  page: ImagePage,
  reference: ImageRegion["layoutArea"],
  read: (member: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const bytes = await read(reference.path);
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
  const pixels = await decode_normalized_image_rgb(bytes);
  const mask = new Uint8Array(page.width * page.height);
  let nonempty = false;
  for (let px = 0; px < mask.length; px++) {
    const off = px * 3,
      value = pixels.rgb[off]!;
    if (
      (value !== 0 && value !== 255) ||
      pixels.rgb[off + 1] !== value ||
      pixels.rgb[off + 2] !== value
    )
      throw new Error("Region mask must be binary");
    mask[px] = value;
    nonempty ||= value !== 0;
  }
  if (!nonempty) throw new Error("Region mask is empty");
  return mask;
}

/** 读取单个排版区域；语义区域独立，像素范围允许重叠。 */
async function read_image_layout_area(
  page: ImagePage,
  region: ImageRegion,
  read: (member: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  if (region.layoutArea.path !== `layout-areas/${page.pageId}/${region.regionId}.png`)
    throw new Error("Invalid layout area path");
  return read_image_mask(page, region.layoutArea, read);
}

/** 校验页面图片尺寸、二值掩码及消字范围。 */
async function validate_image_page_members(
  page: ImagePage,
  cleanPage: Pick<ImageCleanPage, "clean" | "regions">,
  read: (member: string) => Promise<Uint8Array>,
): Promise<void> {
  const originalBytes = await read(page.original);
  const origMeta = image_metadata(originalBytes);
  if (
    origMeta.width !== page.width ||
    origMeta.height !== page.height ||
    origMeta.orientation !== page.orientation
  )
    throw new Error("Image metadata mismatch");

  const baseBytes = await read(cleanPage.clean);
  const baseMeta = image_metadata(baseBytes);
  if (
    baseMeta.extension !== ".png" ||
    baseMeta.width !== page.width ||
    baseMeta.height !== page.height
  )
    throw new Error("Clean image dimensions mismatch");
  for (let index = 0; index < page.regions.length; index++) {
    const region = page.regions[index]!;
    const result = cleanPage.regions[index]!;
    const layoutArea = await read_image_layout_area(page, region, read);
    if (result.status === "failed") continue;
    if (!result.eraseMask) throw new Error("Missing erase mask");
    const mask = await read_image_mask(page, { path: result.eraseMask }, read);
    for (let px = 0; px < mask.length; px++) {
      if (mask[px] && !layoutArea[px]) throw new Error("Erase mask exceeds region layout area");
    }
  }
}

/** 读取并校验 `.image` 归档的成员、结构、图片尺寸与消字范围。 */
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
    validate_image_book(book, records);
    validate_image_clean(clean, book);
    const expected = new Set<string>([
      "items.json",
      IMAGE_STATE_MEMBER,
      IMAGE_CLEAN_MEMBER,
      ...book.pages.map((p) => p.original),
      ...clean.pages.map((p) => p.clean),
      ...clean.pages.flatMap((p) => p.regions.flatMap((r) => (r.eraseMask ? [r.eraseMask] : []))),
      ...book.pages.flatMap((p) => p.regions.map((r) => r.layoutArea.path)),
    ]);
    const missing = [...expected].filter((name) => !members.has(name));
    const extra = [...members.keys()].filter((name) => !expected.has(name));
    if (missing.length || extra.length)
      throw new Error(
        `Image members mismatch: missing ${missing.length} ${JSON.stringify(missing.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}; extra ${extra.length} ${JSON.stringify(extra.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}`,
      );
    for (let i = 0; i < book.pages.length; i++) {
      const page = book.pages[i]!;
      const cleanPage = clean.pages[i]!;
      await validate_image_page_members(page, cleanPage, async (member) => {
        const entry = members.get(member);
        if (!entry) throw new Error("Missing image member");
        return entry.async("uint8array");
      });
    }
    return { book, records, clean, members };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "file.asset_too_large") throw cause;
    throw new AppError("file.invalid_structure", { cause, public_details: { file } });
  }
}

/** 相对路径与区域号跨重新创建保持稳定，项目域据此复制已完成事实。 */
export function image_record_identities(book: ImageBook, records: readonly ImageRecord[]) {
  const pages = new Map(book.pages.map((page) => [page.pageId, page]));
  return new Map(
    records.map((record, row) => {
      const page = pages.get(record.pageId)!;
      return [
        page.relativePath.toLocaleLowerCase("en-US") + "/" + record.regionId,
        {
          row,
          source: record.message,
          image: [page.sha256, page.orientation, page.width, page.height].join(":"),
        },
      ];
    }),
  );
}

/** 从工程条目形成与固化原稿绑定的图片译文快照。 */
export async function build_image_text_input(
  content: Uint8Array,
  items: readonly Item[],
  file: string,
) {
  const { book, records, clean, members } = await read_image_package(content, file);
  write_message_records(records, items, file);
  const byRow = new Map(items.map((item) => [item.row, item]));
  const input: ImageTextInput = {
    records: records.map((record, row) => {
      const item = byRow.get(row);
      const output =
        item?.status === "PROCESSED"
          ? ("translated" as const)
          : item?.status === "EXCLUDED"
            ? ("original" as const)
            : null;
      return {
        pageId: record.pageId,
        regionId: record.regionId,
        output,
        text:
          output === "translated" && item ? (read_translation_for_generation(item) ?? null) : null,
      };
    }),
  };
  return { book, clean, input, members };
}

/** 图片格式建立工程条目；文件生成服务消费同一归档契约写出译图。 */
export class ImageFormat {
  /** 一次读取同时交付条目和已验证身份，替换流程复用这份解析结果。 */
  public async read(content: Uint8Array, file: string) {
    const { book, records } = await read_image_package(content, file);
    const regions = new Map(
      book.pages.flatMap((page) =>
        page.regions.map((region) => [page.pageId + "/" + region.regionId, region] as const),
      ),
    );
    return {
      items: records.map((record, row) =>
        create_item({
          src: record.message,
          row,
          tag: regions.get(record.pageId + "/" + record.regionId)!.kind,
          file_type: "IMAGE",
          file_path: file,
        }),
      ),
      image: { book, records },
    };
  }
}
