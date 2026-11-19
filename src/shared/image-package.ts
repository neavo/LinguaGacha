import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { is_portable_file_name } from "./utils/file-name";
import { GENERIC_ITEM_SCHEMA } from "./generic-package";
import { IMAGE_FONT_SIZE_SCHEMA } from "./image-font-size";

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
export const IMAGE_BOX_SCHEMA = Type.Tuple([
  Type.Integer({ minimum: 0 }),
  Type.Integer({ minimum: 0 }),
  Type.Integer({ minimum: 1 }),
  Type.Integer({ minimum: 1 }),
]);
export const IMAGE_KIND_SCHEMA = Type.Union([Type.Literal("bubble"), Type.Literal("unframed")]);
const COLOR_CHANNEL = Type.Integer({ minimum: 0, maximum: 255 });
export const IMAGE_COLOR_SCHEMA = Type.Tuple([COLOR_CHANNEL, COLOR_CHANNEL, COLOR_CHANNEL]);
const REGION_SCHEMA = Type.Object(
  {
    regionId: IMAGE_ID_SCHEMA,
    kind: IMAGE_KIND_SCHEMA,
    box: IMAGE_BOX_SCHEMA,
    patch: Type.Union([
      Type.Object(
        { path: Type.String({ minLength: 1 }), box: IMAGE_BOX_SCHEMA },
        { additionalProperties: false },
      ),
      Type.Null(), // 自动消字失败后仍保留区域和原文，供后续补做。
    ]),
    parts: Type.Optional(Type.Array(IMAGE_ID_SCHEMA, { minItems: 2 })),
    layout: Type.Optional(Type.Literal("whole")),
    fontSize: Type.Optional(IMAGE_FONT_SIZE_SCHEMA),
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
          regions: Type.Array(REGION_SCHEMA, { maxItems: 10000 }),
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

/** 默认选分格。版式只决定哪些区域参与翻译，区域本身仍可保留原图。 */
export function select_image_regions(book: ImageBook): Map<string, ImageRegion> {
  const selected = new Map<string, ImageRegion>();
  for (const page of book.pages) {
    const inactive = new Set(
      page.regions.flatMap(({ regionId, parts, layout }) =>
        parts ? (layout === "whole" ? parts : [regionId]) : [],
      ),
    );
    for (const region of page.regions)
      if (!inactive.has(region.regionId)) selected.set(page.pageId + "/" + region.regionId, region);
  }
  return selected;
}

const IMAGE_FONT_SIZES_SCHEMA = Type.Array(
  Type.Object(
    {
      pageId: IMAGE_ID_SCHEMA,
      regionId: IMAGE_ID_SCHEMA,
      fontSize: Type.Union([IMAGE_FONT_SIZE_SCHEMA, Type.Null()]),
    },
    { additionalProperties: false },
  ),
);

/** 同一批字号修改必须指向现有区域，每个区域只有一个值。 */
export function read_image_font_sizes(book: ImageBook, value: unknown): Map<string, number | null> {
  if (!Check(IMAGE_FONT_SIZES_SCHEMA, value)) throw new Error("Invalid image font sizes");
  const regions = new Set(
    book.pages.flatMap((page) => page.regions.map(({ regionId }) => page.pageId + "/" + regionId)),
  );
  const sizes = new Map<string, number | null>();
  for (const { pageId, regionId, fontSize } of value) {
    const key = pageId + "/" + regionId;
    if (!regions.delete(key)) throw new Error("Unknown or duplicate image font size target");
    sizes.set(key, fontSize);
  }
  return sizes;
}

/** 物理区域单独保存掩码，整泡复用子格路径。 */
export function image_layout_area_path(pageId: string, regionId: string): string {
  return `layout-areas/${pageId}/${regionId}.png`;
}
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

export const IMAGE_PAGE_MAX_PIXELS = 100_000_000; // 限制单页解码与掩码内存。

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

/** 每个区域恰好有一条原文。写字框和消字补丁都以旋正后的原图为准。 */
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
    if (
      read_image_member_path(page.original) !== page.original ||
      !/^originals\/[^/]+\.(png|jpe?g)$/iu.test(page.original)
    )
      throw new Error("Invalid original path");
    const regionIds = new Map<string, ImageRegion>();
    for (const region of page.regions) {
      if (regionIds.has(region.regionId)) throw new Error("Duplicate region");
      regionIds.set(region.regionId, region);
      const key = page.pageId + "/" + region.regionId;
      regions.add(key);
      const { patch } = region;
      if (patch && patch.path !== `patches/${page.pageId}/${region.regionId}.png`)
        throw new Error("Invalid image patch path");
      for (const [x, y, width, height] of patch ? [region.box, patch.box] : [region.box])
        if (x + width > page.width || y + height > page.height)
          throw new Error("Image region bounds exceed page");
    }
    const assignedParts = new Set<string>();
    for (const region of page.regions) {
      if (!region.parts) {
        if (region.layout !== undefined) throw new Error("Image layout requires bubble parts");
        continue;
      }
      if (region.kind !== "bubble" || region.patch) throw new Error("Invalid whole-bubble region");
      for (const id of region.parts) {
        const part = regionIds.get(id);
        if (part?.kind !== "bubble" || part.parts || assignedParts.has(id))
          throw new Error("Invalid or duplicate bubble part");
        const [x, y, width, height] = region.box;
        const [left, top, partWidth, partHeight] = part.box;
        if (left < x || top < y || left + partWidth > x + width || top + partHeight > y + height)
          throw new Error("Bubble part lies outside its whole bubble");
        assignedParts.add(id);
      }
    }
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

const WRITEBACK_ID = { pageId: IMAGE_ID_SCHEMA, regionId: IMAGE_ID_SCHEMA };
const IMAGE_WRITEBACK_ITEM_SCHEMA = Type.Union([
  Type.Object(
    { ...WRITEBACK_ID, output: Type.Literal("translated"), text: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...WRITEBACK_ID, output: Type.Union([Type.Literal("original"), Type.Null()]) },
    { additionalProperties: false },
  ),
]);

export type ImageWritebackItem = Static<typeof IMAGE_WRITEBACK_ITEM_SCHEMA>;
const IMAGE_WRITEBACK_SCHEMA = Type.Array(IMAGE_WRITEBACK_ITEM_SCHEMA);

/** 写回输入与当前版式的原稿条目顺序一致，每个参与区域只有一个输出决定。 */
export function read_image_writeback(
  value: unknown,
  records: readonly ImageRecord[],
): ImageWritebackItem[] {
  if (
    !Check(IMAGE_WRITEBACK_SCHEMA, value) ||
    value.length !== records.length ||
    value.some(
      (item, index) =>
        item.pageId !== records[index]!.pageId || item.regionId !== records[index]!.regionId,
    )
  )
    throw new Error("Image writeback does not match the source records");
  return value;
}
