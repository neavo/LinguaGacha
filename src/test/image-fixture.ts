import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { png_fixture } from "./media-fixture";
import { write_zip } from "./zip-fixture";
import {
  image_layout_area_path,
  type ImageBook,
  type ImagePage,
  type ImageRecord,
} from "../shared/image-package";

/** 构建完整 `.image` 夹具，测试可替换像素成员及其清单尺寸。 */
export function image_fixture(
  ids: string[] = ["first", "second"],
  {
    original = png_fixture(),
    size: [width, height] = [1, 1],
    layoutArea = layout_area_fixture(),
    patch = patch_fixture(),
  }: {
    original?: Buffer;
    size?: readonly [number, number];
    layoutArea?: Uint8Array;
    patch?: Buffer;
  } = {},
) {
  const sha = createHash("sha256").update(original).digest("hex");
  const pages: ImagePage[] = ids.map((pageId) => ({
    pageId,
    relativePath: `${pageId}.png`,
    original: `originals/${pageId}.png`,
    sha256: sha,
    width,
    height,
    orientation: 1,
    regions: [
      {
        regionId: "text",
        kind: "bubble",
        box: [0, 0, width, height],
        patch: { path: `patches/${pageId}/text.png`, box: [0, 0, width, height] },
        direction: "vertical-rl",
        backgroundColor: [255, 255, 255],
      },
    ],
  }));
  const book: ImageBook = { bookId: "book", pages };
  const records: ImageRecord[] = ids.map((pageId) => ({
    pageId,
    regionId: "text",
    message: "うん",
  }));
  const pack = () => {
    const entries = new Map<string, string | Uint8Array>([
      ["image.json", JSON.stringify(book)],
      ["items.json", JSON.stringify(records)],
    ]);
    for (const page of book.pages) {
      entries.set(page.original, original);
      for (const region of page.regions) {
        if (!region.parts)
          entries.set(image_layout_area_path(page.pageId, region.regionId), layoutArea);
        if (region.patch) entries.set(region.patch.path, patch);
      }
    }
    return write_zip(entries);
  };
  return { book, records, original, patch, pack };
}

/** 测试自有 RGBA 补丁，可覆盖透明度校验。 */
export function patch_fixture(values: readonly number[] = [255]): Buffer {
  const width = values.length;
  const raw = Buffer.alloc(width * 4 + 1);
  for (let x = 0; x < width; x++) raw[(x + 1) * 4] = values[x]!;
  return image_png(width, 1, 6, raw);
}

export function layout_area_fixture(value = 255): Buffer {
  return image_png(1, 1, 0, Buffer.from([0, value]));
}

/** 编码单个完整块，测试可组合连续或被打断的 IDAT。 */
export function png_chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** 接收已编码的扫描行，测试可直接指定滤波与像素数据。 */
export function image_png(
  width: number,
  height: number,
  colorType: number,
  raw: Uint8Array,
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    png_chunk("IHDR", header),
    png_chunk("IDAT", deflateSync(raw)),
    png_chunk("IEND", Buffer.alloc(0)),
  ]);
}
