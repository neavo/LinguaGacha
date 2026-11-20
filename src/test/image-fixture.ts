import { png_fixture } from "./media-fixture";
import { write_zip } from "./zip-fixture";
import {
  image_layout_area_path,
  type ImageBook,
  type ImagePage,
  type ImageRecord,
} from "../shared/image-package";

// 成员只用于封包与复制，使用可区分的字节验证来源。
export const IMAGE_LAYOUT_FIXTURE = Buffer.from("layout");
export const IMAGE_PATCH_FIXTURE = Buffer.from("patch");
export const IMAGE_PATCH_MASK_FIXTURE = Buffer.from("patch-mask");
const IMAGE_FIXTURE_SHA256 = "0".repeat(64);

/** 构建可检查清单、成员与条目关系的 `.image` 夹具。 */
export function image_fixture(ids: string[] = ["first", "second"]) {
  const original = png_fixture();
  const pages: ImagePage[] = ids.map((pageId) => ({
    pageId,
    relativePath: `${pageId}.png`,
    original: `originals/${pageId}.png`,
    sha256: IMAGE_FIXTURE_SHA256,
    width: 1,
    height: 1,
    orientation: 1,
    regions: [
      {
        regionId: "text",
        kind: "bubble",
        box: [0, 0, 1, 1],
        patch: {
          path: `patches/${pageId}/text.png`,
          mask: `patch-masks/${pageId}/text.png`,
          box: [0, 0, 1, 1],
        },
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
          entries.set(image_layout_area_path(page.pageId, region.regionId), IMAGE_LAYOUT_FIXTURE);
        if (region.patch) {
          entries.set(region.patch.path, IMAGE_PATCH_FIXTURE);
          entries.set(region.patch.mask, IMAGE_PATCH_MASK_FIXTURE);
        }
      }
    }
    return write_zip(entries);
  };
  return { book, records, original, pack };
}
