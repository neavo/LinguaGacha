import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { is_portable_file_name } from "./utils/file-name";
import { GENERIC_ITEM_SCHEMA } from "./generic-package";

export const IMAGE_ID_SCHEMA = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9_-]+$",
}); // 跨包与页面引用的稳定标识。
const SHA256 = Type.String({ pattern: "^[a-f0-9]{64}$" }); // 原图内容身份。
export const IMAGE_DIRECTION_SCHEMA = Type.Union([
  Type.Literal("horizontal-tb"),
  Type.Literal("vertical-rl"),
]); // 文本块书写方向。
const IMAGE_LAYOUT_AREA_SCHEMA = Type.Object(
  { path: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
const IMAGE_QUAD_SCHEMA = Type.Tuple([
  Type.Tuple([Type.Integer(), Type.Integer()]),
  Type.Tuple([Type.Integer(), Type.Integer()]),
  Type.Tuple([Type.Integer(), Type.Integer()]),
  Type.Tuple([Type.Integer(), Type.Integer()]),
]);
const IMAGE_TEXT_BOX_SCHEMA = Type.Object(
  {
    textBoxId: IMAGE_ID_SCHEMA,
    box: IMAGE_QUAD_SCHEMA,
    coreBox: IMAGE_QUAD_SCHEMA,
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const COLOR_CHANNEL = Type.Integer({ minimum: 0, maximum: 255 });
const IMAGE_COLOR_SCHEMA = Type.Tuple([COLOR_CHANNEL, COLOR_CHANNEL, COLOR_CHANNEL]);
const REGION_SCHEMA = Type.Object(
  {
    regionId: IMAGE_ID_SCHEMA,
    kind: Type.Union([Type.Literal("bubble"), Type.Literal("unframed")]),
    textBoxIds: Type.Array(IMAGE_ID_SCHEMA, { minItems: 1, maxItems: 10000 }),
    layoutArea: IMAGE_LAYOUT_AREA_SCHEMA,
    direction: IMAGE_DIRECTION_SCHEMA,
    backgroundColor: IMAGE_COLOR_SCHEMA,
  },
  { additionalProperties: false },
);

/** 图片书完整结构契约，用于 `.image` 归档校验。 */
export const IMAGE_BOOK_SCHEMA = Type.Object(
  {
    bookId: IMAGE_ID_SCHEMA,
    pages: Type.Array(
      Type.Object(
        {
          pageId: IMAGE_ID_SCHEMA,
          relativePath: Type.String({ minLength: 1 }),
          original: Type.String({ minLength: 1 }),
          sha256: SHA256,
          width: Type.Integer({ minimum: 1, maximum: 100000 }),
          height: Type.Integer({ minimum: 1, maximum: 100000 }),
          orientation: Type.Integer({ minimum: 1, maximum: 8 }),
          textBoxes: Type.Array(IMAGE_TEXT_BOX_SCHEMA, { maxItems: 10000 }),
          regions: Type.Array(REGION_SCHEMA, { maxItems: 10000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);

const CLEAN_REGION_SCHEMA = Type.Object(
  {
    regionId: IMAGE_ID_SCHEMA,
    status: Type.Union([Type.Literal("cleaned"), Type.Literal("failed")]),
    eraseMask: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

/** 自动底图与实际掩码清单契约（`clean.json`）。 */
export const IMAGE_CLEAN_SCHEMA = Type.Object(
  {
    bookId: IMAGE_ID_SCHEMA,
    pages: Type.Array(
      Type.Object(
        {
          pageId: IMAGE_ID_SCHEMA,
          clean: Type.String({ minLength: 1 }),
          regions: Type.Array(CLEAN_REGION_SCHEMA, { maxItems: 10000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);

export type ImageDirection = Static<typeof IMAGE_DIRECTION_SCHEMA>;
export type ImageBook = Static<typeof IMAGE_BOOK_SCHEMA>;
export type ImagePage = ImageBook["pages"][number];
export type ImageRegion = ImagePage["regions"][number];
export type ImageClean = Static<typeof IMAGE_CLEAN_SCHEMA>;
export type ImageCleanPage = ImageClean["pages"][number];
export type ImageCleanRegion = ImageCleanPage["regions"][number];
export const IMAGE_RECORD_SCHEMA = Type.Object(
  {
    message: GENERIC_ITEM_SCHEMA.properties.message,
    pageId: IMAGE_ID_SCHEMA,
    regionId: IMAGE_ID_SCHEMA,
  },
  { additionalProperties: false },
); // 与图片区域一一对应的原文条目。
export const IMAGE_RECORDS_SCHEMA = Type.Array(IMAGE_RECORD_SCHEMA);
export type ImageRecord = Static<typeof IMAGE_RECORD_SCHEMA>;

const IMAGE_PAGE_MAX_PIXELS = 100_000_000; // 限制单页解码与掩码内存。

/** 包内路径跨平台保存，Schema 之外拒绝越界与 Windows 路径别名。 */
function read_image_member_path(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  if (!normalized.split("/").every(is_portable_file_name)) throw new Error("Invalid image path");
  return normalized;
}

/** 读取图片包条目并拒绝领域外字段。 */
export function read_image_records(value: unknown): ImageRecord[] {
  if (!Check(IMAGE_RECORDS_SCHEMA, value)) throw new Error("Invalid image records");
  return value;
}

/** 每个有效 OCR 框恰好属于一个区域，每个区域恰好有一条原文。 */
export function read_image_book(value: unknown, records: readonly ImageRecord[]): ImageBook {
  if (!Check(IMAGE_BOOK_SCHEMA, value)) throw new Error("Invalid image state");
  const pageIds = new Set<string>();
  const relativePaths = new Set<string>();
  const regions = new Set<string>(); // 与原文记录对齐时逐个移除，剩余区域缺少原文。
  for (const page of value.pages) {
    if (pageIds.has(page.pageId) || page.width * page.height > IMAGE_PAGE_MAX_PIXELS)
      throw new Error("Invalid image page");
    pageIds.add(page.pageId);
    const relativePath = read_image_member_path(page.relativePath);
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
      read_image_member_path(page.original) !== page.original ||
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
      for (const textBoxId of region.textBoxIds) {
        if (!textBoxIds.has(textBoxId) || assignedTextBoxIds.has(textBoxId))
          throw new Error("Invalid or duplicate region text box");
        assignedTextBoxIds.add(textBoxId);
      }
    }
    if (assignedTextBoxIds.size !== textBoxIds.size)
      throw new Error("Every detected text box must belong to one region");
  }
  const pageOrder = new Map(value.pages.map((page, index) => [page.pageId, index]));
  let previousPage = -1;
  for (const record of records) {
    const key = record.pageId + "/" + record.regionId;
    if (!regions.delete(key)) throw new Error("Invalid image record reference");
    if (!record.message.trim()) throw new Error("Image region requires non-empty source text");
    const order = pageOrder.get(record.pageId)!;
    if (order < previousPage) throw new Error("Image records do not follow page order");
    previousPage = order;
  }
  if (regions.size) throw new Error("Image region requires non-empty source text");
  return value;
}

/** `clean.json` 与 `image.json` 的页序、区域顺序、状态和成员路径必须一致。 */
export function read_image_clean(value: unknown, book: ImageBook): ImageClean {
  if (!Check(IMAGE_CLEAN_SCHEMA, value)) throw new Error("Invalid clean manifest");
  if (value.bookId !== book.bookId || value.pages.length !== book.pages.length)
    throw new Error("Clean manifest book mismatch");
  for (let i = 0; i < book.pages.length; i++) {
    const bookPage = book.pages[i]!;
    const cleanPage = value.pages[i]!;
    if (cleanPage.pageId !== bookPage.pageId) throw new Error("Clean page order mismatch");
    const expectedClean = `clean/${bookPage.pageId}.png`;
    if (
      read_image_member_path(cleanPage.clean) !== cleanPage.clean ||
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
          read_image_member_path(cleanRegion.eraseMask) !== cleanRegion.eraseMask
        )
          throw new Error("Invalid cleaned region");
      }
    }
  }
  return value;
}
