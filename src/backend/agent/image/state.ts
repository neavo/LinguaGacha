import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { default_native_fs as fs } from "../../../native/native-fs";
import type {
  ImageBook,
  ImageCleanRegion,
  ImagePage,
  ImageRecord,
  ImageLayoutArea,
} from "../../../shared/image";
import { erase_input_digest, validate_image_book } from "../../file/image/image-format";
import { normalize_image_to_png } from "../../file/image/image-pixels";

export const STATE_FILE = "draft.json";
export const EVIDENCE_INDEX_FILE = "evidence/index.json";
const LOCK_RETRY = { retries: 100, minTimeout: 100, maxTimeout: 1000 };
const COMMIT_RETRY = Object.freeze({ attempts: 5, delayMs: 100 });

/** Windows 可能在刚写入 PNG 后短暂拒绝目录改名。持锁重试同一次原子提交，不删除目标。 */
export async function commit_directory(temporary: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rename(temporary, destination);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EPERM" && error.code !== "EBUSY") ||
        attempt >= COMMIT_RETRY.attempts - 1
      )
        throw error;
      await delay(COMMIT_RETRY.delayMs);
    }
  }
}

/** 草稿只引用当前验收目录和产生它的运行，字节摘要留在归档清单。 */
export type ReviewedPageRef = {
  inputSha256: string;
  reviewId: string;
  runId: string;
};

export type Draft = {
  revision: number;
  confirmed: boolean;
  book: ImageBook;
  records: ImageRecord[];
  reviewed?: Record<string, ReviewedPageRef>;
};

export type PrepareBubbleEvidence = {
  regionId: string;
  score: number;
  box: [number, number, number, number]; // 规范化原图中的 x0/y0/x1/y1，仅用于取证。
  rawMask: string;
  overlaps: string[];
  status: "ready" | "empty_area" | "covered";
  layoutArea?: ImageLayoutArea;
  color?: [number, number, number];
  background?: { route: "fill" | "model"; coverage: number | null; samplePixels: number };
};

export type PreparePageEvidence = {
  pageId: string;
  width: number;
  height: number;
  preview: string;
  previewScale: number;
  fillPreview: string;
  textBoxes: {
    textBoxId: string;
    box: [[number, number], [number, number], [number, number], [number, number]];
    coreBox: [[number, number], [number, number], [number, number], [number, number]];
    ownerRegionId: string | null;
  }[];
  backgrounds: Record<
    string,
    { route: "fill" | "model"; coverage: number | null; samplePixels: number }
  >;
  crops: Record<string, string>;
  bubbles: PrepareBubbleEvidence[];
};

export type EraseRegionResult = {
  regionId: string;
  disposition: "translate" | "preserve";
  preserveReason?: "intentional" | "repair_failed" | "unreadable";
  method?: "fill" | "strokes" | "boxes";
  eraseMask?: string;
  eraseMaskSha256?: string;
  diagnostics: { method: string; error: string }[];
};

export type ErasePageResult = {
  pageId: string;
  inputSha256: string;
  clean: string;
  cleanSha256: string;
  regions: EraseRegionResult[];
};

export type EraseRun = {
  pages: ErasePageResult[];
};

export type ReviewedRegion = Omit<ImageCleanRegion, "eraseMask">; // 验收目录由区域身份定位掩码，记录只保存摘要。

export type ReviewRecord = {
  pageId: string;
  inputSha256: string;
  cleanSha256: string;
  regions: ReviewedRegion[];
};

type NormalizedMeta = {
  sourceSha256: string;
  width: number;
  height: number;
  orientation: number;
};

/** 同一工作目录串行修改，修订检查与落盘共用锁。 */
export async function locked<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await fs.make_dir_async(directory);
  const release = await lockfile.lock(directory, { realpath: false, retries: LOCK_RETRY });
  try {
    return await action();
  } finally {
    await release();
  }
}

/** 流式计算文件摘要，避免额外持有整页 PNG 字节。 */
export async function file_sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of fs.create_read_stream(file)) hash.update(bytes as Buffer);
  return hash.digest("hex");
}

/** JSON 解析只恢复数据，各阶段的契约校验负责结构与资产引用。 */
export function read_json<T>(file: string): T {
  return JSON.parse(fs.read_text_file(file)) as T;
}

/** 调用方持有工作区锁，单文件原子替换避免留下截断的状态。 */
export function write_json(file: string, value: unknown): void {
  fs.write_file_atomic(file, JSON.stringify(value, null, 2));
}

/** 仅把文件不存在视为缺失，权限与其它 IO 错误继续传播。 */
export function file_exists(file: string): boolean {
  try {
    fs.stat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** 加载草稿并按确认态校验结构契约。 */
export function load_draft(directory: string): Draft {
  const state = read_json<Draft>(path.join(directory, STATE_FILE));
  if (!Number.isSafeInteger(state.revision) || typeof state.confirmed !== "boolean")
    throw new Error("Invalid image draft");
  validate_image_book(state.book, state.records, { confirmed: state.confirmed });
  return state;
}

export const normalized_path = (directory: string, pageId: string): string =>
  path.join(directory, "normalized", `${pageId}.png`);

export const normalized_meta_path = (directory: string, pageId: string): string =>
  path.join(directory, "normalized", `${pageId}.json`);

export const reviewed_dir = (directory: string, pageId: string, reviewId: string): string =>
  path.join(directory, "reviewed", pageId, reviewId);

/** 调用方已验证源文件，持锁复制后原子提交验收目录。 */
export async function stage_reviewed_page(
  directory: string,
  reviewId: string,
  params: {
    pageId: string;
    inputSha256: string;
    cleanSource: string;
    cleanSha256: string;
    regions: readonly (ReviewedRegion & { eraseMaskSource?: string })[];
  },
): Promise<void> {
  const reviewedRegions: ReviewedRegion[] = params.regions.map((region) =>
    region.disposition === "preserve"
      ? {
          regionId: region.regionId,
          disposition: "preserve",
          ...(region.preserveReason ? { preserveReason: region.preserveReason } : {}),
        }
      : {
          regionId: region.regionId,
          disposition: "translate",
          eraseMaskSha256: region.eraseMaskSha256!,
        },
  );
  const revDir = reviewed_dir(directory, params.pageId, reviewId);

  const temporary = path.join(directory, "reviewed", params.pageId, `.${reviewId}-${randomUUID()}`);
  await fs.make_dir_async(path.join(temporary, "masks"));
  try {
    const destClean = path.join(temporary, "clean.png");
    fs.copy_file(params.cleanSource, destClean);

    for (const region of params.regions) {
      if (region.disposition === "preserve") continue;
      if (!region.eraseMaskSource || !region.eraseMaskSha256)
        throw new Error(`Missing erase mask artifact for ${params.pageId}/${region.regionId}`);
      const destMask = path.join(temporary, "masks", `${region.regionId}.png`);
      fs.copy_file(region.eraseMaskSource, destMask);
    }

    write_json(path.join(temporary, "review.json"), {
      pageId: params.pageId,
      inputSha256: params.inputSha256,
      cleanSha256: params.cleanSha256,
      regions: reviewedRegions,
    } satisfies ReviewRecord);

    await commit_directory(temporary, revDir);
  } catch (error) {
    await fs.remove_async(temporary, { recursive: true, force: true });
    throw error;
  }
}

/** 工作目录只核对当前引用和文件存在，归档读取边界负责字节完整性。 */
function verify_review_dir(
  revDir: string,
  pageId: string,
  inputSha256: string,
): { review: ReviewRecord; cleanPath: string; maskPaths: Map<string, string> } {
  const reviewFile = path.join(revDir, "review.json");
  if (!file_exists(reviewFile))
    throw new Error(`Page clean image not reviewed for current specification: ${pageId}`);
  const review = read_json<ReviewRecord>(reviewFile);
  if (review.pageId !== pageId || review.inputSha256 !== inputSha256)
    throw new Error(`Reviewed record identity mismatch: ${pageId}`);

  const cleanPath = path.join(revDir, "clean.png");
  if (!file_exists(cleanPath)) throw new Error(`Reviewed clean image missing: ${pageId}`);

  const maskPaths = new Map<string, string>();
  for (const item of review.regions) {
    if (item.disposition === "preserve") continue;
    if (!item.eraseMaskSha256)
      throw new Error(`Translated region missing reviewed mask: ${pageId}/${item.regionId}`);
    const maskPath = path.join(revDir, "masks", `${item.regionId}.png`);
    if (!file_exists(maskPath))
      throw new Error(`Reviewed mask missing: ${pageId}/${item.regionId}`);
    maskPaths.set(item.regionId, maskPath);
  }
  return { review, cleanPath, maskPaths };
}

/** 确保规范化 PNG 与当前原稿身份、尺寸和方向一致。与归档读取共用同一 MuPDF 规范化解码。 */
export async function ensure_normalized(
  directory: string,
  pages: readonly ImagePage[],
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  for (const page of pages) {
    const source = path.join(directory, page.original);
    if (!file_exists(source)) throw new Error(`Original image missing: ${page.pageId}`);
    const target = normalized_path(directory, page.pageId);
    const metaFile = normalized_meta_path(directory, page.pageId);
    paths.set(page.pageId, target);

    let cacheValid = false;
    if (file_exists(target) && file_exists(metaFile)) {
      try {
        const meta = read_json<NormalizedMeta>(metaFile);
        cacheValid =
          meta.sourceSha256 === page.sha256 &&
          meta.width === page.width &&
          meta.height === page.height &&
          meta.orientation === page.orientation;
      } catch {
        cacheValid = false; // 规范化缓存可从已核对的原图重建。
      }
    }
    if (!cacheValid) {
      const normalized = await normalize_image_to_png(fs.read_file(source));
      if (normalized.width !== page.width || normalized.height !== page.height)
        throw new Error(`Normalized dimensions mismatch on page: ${page.pageId}`);
      fs.write_file_atomic(target, normalized.png);
      write_json(metaFile, {
        sourceSha256: page.sha256,
        width: page.width,
        height: page.height,
        orientation: page.orientation,
      } satisfies NormalizedMeta);
    }
  }
  return paths;
}

/** 校验草稿当前引用的单页验收产物是否存在且未过期，并构造 `clean.json` 区域列表。 */
export async function verify_reviewed_page(
  directory: string,
  draft: Draft,
  page: ImagePage,
): Promise<{
  review: ReviewRecord;
  cleanPath: string;
  maskPaths: Map<string, string>;
  cleanRegions: ImageCleanRegion[];
}> {
  const inputSha256 = erase_input_digest(page);
  const ref = draft.reviewed?.[page.pageId];
  if (!ref || ref.inputSha256 !== inputSha256)
    throw new Error(`Page clean image not reviewed for current specification: ${page.pageId}`);
  const revDir = reviewed_dir(directory, page.pageId, ref.reviewId);
  const { review, cleanPath, maskPaths } = verify_review_dir(revDir, page.pageId, inputSha256);

  const byRegion = new Map(review.regions.map((r) => [r.regionId, r]));
  if (byRegion.size !== page.regions.length)
    throw new Error(`Reviewed region count mismatch: ${page.pageId}`);

  const cleanRegions: ImageCleanRegion[] = [];
  for (const region of page.regions) {
    const item = byRegion.get(region.regionId);
    if (!item || item.disposition !== region.disposition)
      throw new Error(`Reviewed region mismatch: ${page.pageId}/${region.regionId}`);
    if (region.disposition === "preserve") {
      if (item.eraseMaskSha256)
        throw new Error(
          `Preserve region cannot carry erase mask: ${page.pageId}/${region.regionId}`,
        );
      cleanRegions.push({
        regionId: region.regionId,
        disposition: "preserve",
        ...(region.preserveReason ? { preserveReason: region.preserveReason } : {}),
      });
    } else {
      if (!item.eraseMaskSha256 || !maskPaths.has(region.regionId))
        throw new Error(
          `Translated region missing reviewed mask: ${page.pageId}/${region.regionId}`,
        );
      cleanRegions.push({
        regionId: region.regionId,
        disposition: "translate",
        eraseMask: `erase-masks/${page.pageId}/${region.regionId}.png`,
        eraseMaskSha256: item.eraseMaskSha256,
      });
    }
  }
  return { review, cleanPath, maskPaths, cleanRegions };
}

/** 页集合与原图身份由 prepare/restore 拥有，区域编辑不能替换它们。 */
export function assert_immutable_pages(
  previous: readonly ImagePage[],
  next: readonly ImagePage[],
): void {
  if (previous.length !== next.length) throw new Error("Original page count cannot be changed");
  const originals = new Map(previous.map((page) => [page.pageId, page]));
  for (const page of next) {
    const orig = originals.get(page.pageId);
    if (
      !orig ||
      orig.original !== page.original ||
      orig.sha256 !== page.sha256 ||
      orig.width !== page.width ||
      orig.height !== page.height ||
      orig.orientation !== page.orientation ||
      !isDeepStrictEqual(orig.textBoxes, page.textBoxes)
    )
      throw new Error("Original identity cannot be changed by layout edits");
  }
}
