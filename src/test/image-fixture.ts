import { png_fixture } from "./media-fixture";
import { write_zip } from "./zip-fixture";
import { erase_input_digest, image_sha256 } from "../backend/file/image/image-format";
import type { ImageBook, ImageClean, ImagePage, ImageRecord } from "../shared/image";

/** 构建最小完整 `.image` 归档与原图/底图/掩码字节测试夹具。 */
export function image_fixture(ids: string[] = ["first", "second"]) {
  const original = png_fixture();
  const sha = image_sha256(original);
  const pages: ImagePage[] = ids.map((pageId) => ({
    pageId,
    original: `originals/${pageId}.png`,
    sha256: sha,
    width: 1,
    height: 1,
    orientation: 1,
    regions: [
      {
        regionId: "text",
        kind: "bubble",
        disposition: "translate",
        textAreas: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        ],
        direction: "vertical-rl",
        erase: { method: "auto", mask: "strokes", exclusions: [] },
      },
    ],
  }));
  const book: ImageBook = { version: 1, bookId: "book", pages };
  const clean: ImageClean = {
    version: 1,
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
              method: "fill" as const,
              mask: `masks/${page.pageId}/${region.regionId}.png`,
              maskSha256: sha,
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
    for (const page of book.pages) entries.set(page.original, original);
    for (const page of clean.pages) {
      entries.set(page.clean, original);
      for (const region of page.regions) {
        if (region.mask) entries.set(region.mask, original);
      }
    }
    return write_zip(entries);
  };
  return { book, clean, records, original, pack };
}
