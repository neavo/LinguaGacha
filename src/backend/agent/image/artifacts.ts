import path from "node:path";
import type { ImageClean, ImageCleanPage } from "../../../shared/image";
import { compute_clean_status } from "../../file/image/image-format";
import { verify_reviewed_page, type Draft } from "./state";

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
      if (region.layoutArea)
        sources[region.layoutArea.path] = path.join(directory, region.layoutArea.path);
    }
    for (const region of cleanRegions)
      if (region.eraseMask) sources[region.eraseMask] = maskPaths.get(region.regionId)!;
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
  return { clean, sources };
}
