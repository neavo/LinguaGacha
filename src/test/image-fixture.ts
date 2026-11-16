import { crc32, deflateSync } from "node:zlib";
import { png_fixture } from "./media-fixture";
import { write_zip } from "./zip-fixture";
import { erase_input_digest, image_sha256 } from "../backend/file/image/image-format";
import type { ImageBook, ImageClean, ImagePage, ImageRecord } from "../shared/image";

/** 构建最小完整 `.image` 归档与原图/底图/掩码字节测试夹具。 */
export function image_fixture(ids: string[] = ["first", "second"]) {
  const original = png_fixture();
  const sha = image_sha256(original);
  const mask = selection_fixture();
  const maskSha = image_sha256(mask);
  const pages: ImagePage[] = ids.map((pageId) => ({
    pageId,
    original: `originals/${pageId}.png`,
    sha256: sha,
    width: 1,
    height: 1,
    orientation: 1,
    textBoxes: [
      {
        textBoxId: "t1",
        box: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        coreBox: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
    ],
    falsePositiveTextBoxIds: [],
    regions: [
      {
        regionId: "text",
        kind: "bubble",
        disposition: "translate",
        textBoxIds: ["t1"],
        layoutArea: { path: `layout-areas/${pageId}/text.png`, sha256: maskSha },
        direction: "vertical-rl",
        backgroundColor: [255, 255, 255],
      },
    ],
  }));
  const book: ImageBook = { bookId: "book", pages };
  const clean: ImageClean = {
    bookId: "book",
    status: "complete",
    pages: pages.map((page) => ({
      pageId: page.pageId,
      clean: `clean/${page.pageId}.png`,
      cleanSha256: sha,
      inputSha256: erase_input_digest(page),
      regions: page.regions.map((region) => ({
        regionId: region.regionId,
        disposition: region.disposition,
        ...(region.preserveReason ? { preserveReason: region.preserveReason } : {}),
        ...(region.disposition === "translate"
          ? {
              eraseMask: `erase-masks/${page.pageId}/${region.regionId}.png`,
              eraseMaskSha256: maskSha,
            }
          : {}),
      })),
    })),
  };
  const records: ImageRecord[] = ids.map((pageId) => ({
    pageId,
    regionId: "text",
    message: "うん",
  }));
  const pack = () => {
    const entries = new Map<string, string | Uint8Array>([
      ["image.json", JSON.stringify(book)],
      ["items.json", JSON.stringify(records)],
      ["clean.json", JSON.stringify(clean)],
    ]);
    for (const page of book.pages) {
      entries.set(page.original, original);
      for (const region of page.regions)
        if (region.layoutArea) entries.set(region.layoutArea.path, mask);
    }
    for (const page of clean.pages) {
      entries.set(page.clean, original);
      for (const region of page.regions) if (region.eraseMask) entries.set(region.eraseMask, mask);
    }
    return write_zip(entries);
  };
  return { book, clean, records, original, mask, pack };
}

/** 测试自有单通道选区 PNG，支持二值及损坏像素场景。 */
export function selection_fixture(
  values: readonly number[] = [255],
  width = values.length,
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const height = values.length / width;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw[y * (width + 1) + x + 1] = values[y * width + x]!;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
