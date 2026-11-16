import path from "node:path";
import type { ImageClean, ImageCleanPage } from "../../../shared/image";
import { compute_clean_status, validate_image_clean } from "../../file/image/image-format";
import { digest, verify_reviewed_page, type Draft } from "./state";

/** 只引用已验收的像素产物，文字编辑和模型更新不触发重算。 */
export async function build_clean_manifest(
  directory: string,
  draft: Draft,
): Promise<{
  clean: ImageClean;
  sources: Record<string, string>;
}> {
  const cleanPages: ImageCleanPage[] = [];
  const sources: Record<string, string> = {};
  for (const page of draft.book.pages) {
    if ((await digest(path.join(directory, page.original))) !== page.sha256)
      throw new Error(`Original image missing or tampered: ${page.pageId}`);
    const {
      review: rev,
      cleanPath,
      maskPaths,
      cleanRegions,
    } = await verify_reviewed_page(directory, draft, page);
    const cleanMember = `clean/${page.pageId}.png`;
    sources[page.original] = path.join(directory, page.original);
    sources[cleanMember] = cleanPath;
    for (const region of page.regions) {
      if (region.selection)
        sources[region.selection.path] = path.join(directory, region.selection.path);
    }
    for (const region of cleanRegions)
      if (region.mask) sources[region.mask] = maskPaths.get(region.regionId)!;
    cleanPages.push({
      pageId: page.pageId,
      clean: cleanMember,
      cleanSha256: rev.cleanSha256,
      inputSha256: rev.inputSha256,
      regions: cleanRegions,
    });
  }
  const clean: ImageClean = {
    bookId: draft.book.bookId,
    status: compute_clean_status(draft.book),
    pages: cleanPages,
  };
  validate_image_clean(clean, draft.book);
  return { clean, sources };
}
