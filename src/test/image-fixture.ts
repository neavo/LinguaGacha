import { png_fixture } from "./media-fixture";
import { write_zip } from "./zip-fixture";
import { image_sha256 } from "../backend/file/image/image-format";
import type { ImageBook, ImageRecord } from "../shared/image";

/** 构建最小完整 `.image` 归档与原图字节测试夹具。 */
export function image_fixture(ids: string[] = ["first", "second"]) {
  const original = png_fixture();
  const book: ImageBook = {
    version: 1,
    bookId: "book",
    pages: ids.map((pageId) => ({
      pageId,
      original: `originals/${pageId}.png`,
      sha256: image_sha256(original),
      width: 1,
      height: 1,
      orientation: 1,
      regions: [
        {
          regionId: "text",
          disposition: "translate",
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          direction: "vertical-rl",
          style: {
            color: "#000000",
            stroke: "#ffffff",
            strokeWidth: 0,
            weight: 400,
            rotation: 0,
            minFontSize: 1,
          },
        },
      ],
    })),
  };
  const records: ImageRecord[] = ids.map((pageId) => ({
    pageId,
    regionId: "text",
    message: "うん",
  }));
  const pack = () =>
    write_zip(
      new Map<string, string | Uint8Array>([
        ["image.json", JSON.stringify(book)],
        ["items.json", JSON.stringify(records)],
        ...book.pages.map((page) => [page.original, original] as [string, Uint8Array]),
      ]),
    );
  return { book, records, original, pack };
}
