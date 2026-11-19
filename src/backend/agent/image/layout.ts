import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import { read_image_font_sizes } from "../../../shared/image-package";
import { IMAGE_STATE_MEMBER, read_image_package_manifest } from "../../file/image/image-package";

type BubbleTarget = { pageId: string; regionId: string };

/** 由整泡或子格定位同一组，只改准备目录中的版式。 */
export function set_image_bubble_layout(
  directory: string,
  { pageId, regionId }: BubbleTarget,
  layout: "split" | "whole",
): { status: "prepared" | "repartition_required" } {
  const root = path.resolve(directory, "package");
  const { book } = read_image_package_manifest(root);
  const page = book.pages.find((page) => page.pageId === pageId);
  const region = page?.regions.find((region) => region.regionId === regionId);
  if (!page || region?.kind !== "bubble") throw new Error("Unknown image bubble");
  const whole = page.regions.find(
    (region) => region.parts && (region.regionId === regionId || region.parts.includes(regionId)),
  );
  if (!whole) return { status: "repartition_required" };
  if (layout === "whole") whole.layout = layout;
  else delete whole.layout;
  fs.write_file_atomic(path.join(root, IMAGE_STATE_MEMBER), JSON.stringify(book));
  return { status: "prepared" };
}

/** 先核对整批字号，再一次保存清单。空值清除固定字号。 */
export function set_image_font_sizes(directory: string, fontSizes: unknown): void {
  const root = path.resolve(directory, "package");
  const { book } = read_image_package_manifest(root);
  const sizes = read_image_font_sizes(book, fontSizes);
  for (const page of book.pages) {
    for (const region of page.regions) {
      const size = sizes.get(page.pageId + "/" + region.regionId);
      if (size === null) delete region.fontSize;
      else if (size !== undefined) region.fontSize = size;
    }
  }
  fs.write_file_atomic(path.join(root, IMAGE_STATE_MEMBER), JSON.stringify(book));
}
