import path from "node:path";

import {
  read_image_book,
  read_image_clean,
  read_image_records,
  type ImageBook,
  type ImageClean,
  type ImageCleanPage,
  type ImagePage,
  type ImageRecord,
  type ImageRegion,
} from "../../../shared/image-package";
import { AppError } from "../../../shared/error";
import { default_native_fs as fs } from "../../../native/native-fs";
import { PACKAGE_ITEMS_MEMBER, read_package_items } from "../shared/package-items";
import { read_zip_members } from "../shared/zip-members";
import { image_metadata } from "./image-metadata";
import { decode_normalized_image_rgb } from "./image-pixels";

const IMAGE_STATE_MEMBER = "image.json"; // 页面、文字框和区域事实。
const IMAGE_CLEAN_MEMBER = "clean.json"; // 自动底图与实际消字掩码。
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
    const cleanMember = members.get(IMAGE_CLEAN_MEMBER);
    if (!stateMember || !cleanMember) throw new Error("Missing image.json or clean.json");
    const records = read_image_records(await read_package_items(members));
    const book = read_image_book(JSON.parse(await stateMember.async("string")), records);
    const clean = read_image_clean(JSON.parse(await cleanMember.async("string")), book);
    await validate_image_members(
      book,
      clean,
      members.keys(),
      options.validatePixels === false
        ? undefined
        : (member) => members.get(member)!.async("uint8array"),
    );
    return { book, records, clean, members };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "file.asset_too_large") throw cause;
    throw new AppError("file.invalid_structure", { cause, public_details: { file } });
  }
}

/** Skill 封包前从工作目录执行与后端相同的当前物理契约。 */
export async function validate_image_package_directory(directory: string): Promise<{
  book: ImageBook;
  records: ImageRecord[];
  clean: ImageClean;
}> {
  directory = path.resolve(directory);
  const records = read_image_records(read_json(path.join(directory, PACKAGE_ITEMS_MEMBER)));
  const book = read_image_book(read_json(path.join(directory, IMAGE_STATE_MEMBER)), records);
  const clean = read_image_clean(read_json(path.join(directory, IMAGE_CLEAN_MEMBER)), book);
  const members = collect_directory_members(directory);
  await validate_image_members(book, clean, members, async (member) =>
    fs.read_file(path.join(directory, member)),
  );
  return { book, records, clean };
}

/** 结构读取器已确认引用关系，这里只核对成员全集与像素事实。 */
async function validate_image_members(
  book: ImageBook,
  clean: ImageClean,
  actualMembers: Iterable<string>,
  read?: (member: string) => Promise<Uint8Array>,
): Promise<void> {
  const expected = new Set<string>([
    PACKAGE_ITEMS_MEMBER,
    IMAGE_STATE_MEMBER,
    IMAGE_CLEAN_MEMBER,
    ...book.pages.map((page) => page.original),
    ...clean.pages.map((page) => page.clean),
    ...clean.pages.flatMap((page) =>
      page.regions.flatMap((region) => (region.eraseMask ? [region.eraseMask] : [])),
    ),
    ...book.pages.flatMap((page) => page.regions.map((region) => region.layoutArea.path)),
  ]);
  const actual = new Set(actualMembers);
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  if (missing.length || extra.length)
    throw new Error(
      `Image members mismatch: missing ${missing.length} ${JSON.stringify(missing.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}; extra ${extra.length} ${JSON.stringify(extra.slice(0, MEMBER_ERROR_SAMPLE_SIZE))}`,
    );
  if (read)
    for (let index = 0; index < book.pages.length; index++)
      await validate_image_page_members(book.pages[index]!, clean.pages[index]!, read);
}

/** 页面原图、底图、排版区域和实际掩码必须属于同一像素空间。 */
async function validate_image_page_members(
  page: ImagePage,
  cleanPage: Pick<ImageCleanPage, "clean" | "regions">,
  read: (member: string) => Promise<Uint8Array>,
): Promise<void> {
  const original = image_metadata(await read(page.original));
  if (
    original.width !== page.width ||
    original.height !== page.height ||
    original.orientation !== page.orientation
  )
    throw new Error("Image metadata mismatch");
  const base = image_metadata(await read(cleanPage.clean));
  if (base.extension !== ".png" || base.width !== page.width || base.height !== page.height)
    throw new Error("Clean image dimensions mismatch");
  for (let index = 0; index < page.regions.length; index++) {
    const region = page.regions[index]!;
    const result = cleanPage.regions[index]!;
    const layoutArea = await read_image_mask(page, region.layoutArea, read);
    if (result.status === "failed") continue;
    const mask = await read_image_mask(page, { path: result.eraseMask! }, read); // 清单已校验成功区域的掩码引用。
    for (let pixel = 0; pixel < mask.length; pixel++)
      if (mask[pixel] && !layoutArea[pixel])
        throw new Error("Erase mask exceeds region layout area");
  }
}

/** 二值掩码必须是单通道 PNG，并与页面尺寸一致。 */
async function read_image_mask(
  page: ImagePage,
  reference: ImageRegion["layoutArea"],
  read: (member: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const bytes = await read(reference.path);
  if (bytes[24] !== 8 || bytes[25] !== 0)
    throw new Error("Region mask must be an 8-bit grayscale PNG");
  const metadata = image_metadata(bytes);
  if (
    metadata.extension !== ".png" ||
    metadata.width !== page.width ||
    metadata.height !== page.height
  )
    throw new Error("Region mask dimensions mismatch");
  const pixels = await decode_normalized_image_rgb(bytes);
  const mask = new Uint8Array(page.width * page.height);
  let nonempty = false;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    const value = pixels.rgb[pixel * 3]!; // PNG 头限定灰阶，读取任一 RGB 通道即可。
    if (value !== 0 && value !== 255) throw new Error("Region mask must be binary");
    mask[pixel] = value;
    nonempty ||= value !== 0;
  }
  if (!nonempty) throw new Error("Region mask is empty");
  return mask;
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
  const jsonMembers = new Set([IMAGE_STATE_MEMBER, PACKAGE_ITEMS_MEMBER, IMAGE_CLEAN_MEMBER]);
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
