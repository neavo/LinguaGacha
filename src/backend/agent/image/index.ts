import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { TSchema } from "typebox";

import { default_native_fs as fs } from "../../../native/native-fs";
import type { ImageQualityResult } from "../../../shared/image";
import type {
  ImageBubbleGroup,
  ImageBubblePartition,
  ImageHelperRequest,
  ImageHelperResponse,
} from "../../../shared/image-helper";
import {
  IMAGE_BOOK_SCHEMA,
  IMAGE_RECORDS_SCHEMA,
  read_image_book,
  type ImageRecord,
  type ImageRegion,
  read_image_records,
} from "../../../shared/image-package";
import { validate_image_package_directory } from "../../file/image/image-package";
import { image_metadata } from "../../file/image/image-metadata";
import { normalize_image_to_png } from "../../file/image/image-pixels";
import { INFERENCE_DEPENDENCIES } from "../inference/environment";
import { create_schema_renderer } from "../workspace/schema-description";
import { workspace_requests } from "../workspace/runtime/request-channel";
import { pixels, type ImageDevice } from "./engine";

export { INFERENCE_DEPENDENCIES };
export { DeviceFailure } from "../inference/client";
export type { ImageDevice } from "./engine";
export { missing_models, prepare_models } from "./models";

/** 图片领域显式安装依赖（与共享推理底座和媒体版本保持一致）。 */
export const IMAGE_DEPENDENCIES = Object.freeze({
  npm: [`onnxruntime-node@${INFERENCE_DEPENDENCIES.ort}`],
  python: [
    `pyclipper==${INFERENCE_DEPENDENCIES.pyclipper}`,
    `numpy==${INFERENCE_DEPENDENCIES.numpy}`,
    `opencv-python-headless==${INFERENCE_DEPENDENCIES.opencv}`,
  ],
});
export type {
  ImageOutputReport,
  ImageOutputSummary,
  ImageQualityResult,
} from "../../../shared/image";
export {
  IMAGE_BOOK_SCHEMA,
  IMAGE_RECORDS_SCHEMA,
  read_image_book,
  read_image_records,
} from "../../../shared/image-package";
export type { ImageBook, ImagePage, ImageRecord, ImageRegion } from "../../../shared/image-package";

export type ImageSource = { path: string; relativePath: string };
export type ImageScanResult = Readonly<{
  directory: string;
  pages: ImageHelperResponse<"scan">["pages"];
}>;

/** 按需呈现当前 `.image` 两个 JSON 的目标形状。 */
export function describe_package(): string {
  return create_schema_renderer(
    new Map<TSchema, string>([
      [IMAGE_BOOK_SCHEMA, "ImageBook"],
      [IMAGE_RECORDS_SCHEMA, "ImageRecords"],
    ]),
  ).declarations();
}

/** Skill 封包前执行与后端相同的当前图片物理契约。 */
export const validate_package = validate_image_package_directory;

/** 使用当前工程状态生成整页图片 QA 预览。 */
export async function generateQA(): Promise<ImageQualityResult> {
  return workspace_requests().call({ kind: "generate_image_qa" });
}

/** 整册共享识别会话。选字前只生成原稿、候选区域和预览。 */
export async function scanPages(
  sources: readonly ImageSource[],
  directory: string,
  device: ImageDevice = "gpu",
): Promise<ImageScanResult> {
  if (sources.length === 0) throw new Error("At least one source image is required");
  if (device !== "cpu" && device !== "gpu") throw new Error("Invalid image device");
  const target = path.resolve(directory);
  if (fs.exists(target)) throw new Error("Image work directory already exists");
  await fs.make_dir_async(path.dirname(target));
  const stage = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}`);
  const normalizedDirectory = path.join(stage, "normalized");
  await fs.make_dir_async(normalizedDirectory);
  try {
    const pageSpecs = [];
    for (const source of sources) {
      const bytes = fs.read_file(source.path);
      const metadata = image_metadata(bytes);
      const pageId = randomUUID();
      const original = `originals/${pageId}${metadata.extension}`;
      fs.write_file_atomic(path.join(stage, original), bytes);
      const normalized = await normalize_image_to_png(bytes);
      const normalizedPath = path.join(normalizedDirectory, `${pageId}.png`);
      await fs.write_file(normalizedPath, normalized.png);
      pageSpecs.push({
        pageId,
        relativePath: source.relativePath.replaceAll("\\", "/"),
        original,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        source: normalizedPath,
      });
    }
    const scanned = await pixels("scan", { pages: pageSpecs, output: stage }, device);
    if (scanned.pages.length !== pageSpecs.length) throw new Error("Invalid image scan result");
    fs.rename(stage, target);
    return {
      directory: target,
      pages: scanned.pages.map((page) => ({
        ...page,
        preview: path.join(target, "diagnostics", path.basename(page.preview)),
      })),
    };
  } finally {
    await fs.remove_async(stage, { recursive: true, force: true });
  }
}

/** 查看目标气泡组的 OCR 编号，预览保持整页。 */
export async function inspectBubbleGroup(
  directory: string,
  target: ImageBubbleGroup,
  output: string,
) {
  const preview = path.resolve(output);
  if (path.extname(preview).toLowerCase() !== ".png" || fs.exists(preview))
    throw new Error("Bubble preview requires a new PNG path");
  return pixels("inspect_bubble_group", {
    ...target,
    root: path.resolve(directory),
    output: preview,
  });
}

type PrepareOptions = { device?: ImageDevice; update?: string };

/** 只处理已选区域。局部补做沿用已入包的原文与写字框。 */
export async function preparePages(
  directory: string,
  selected: ImageHelperRequest<"prepare">["selected"],
  output: string,
  options: PrepareOptions = {},
) {
  return prepare_book(directory, selected, output, options);
}

/** 纠正一个气泡组，生成可原子替换的完整资产。 */
export async function repartitionBubbleGroup(
  directory: string,
  correction: ImageBubblePartition,
  previous: string,
  output: string,
  options: { device?: ImageDevice } = {},
) {
  return prepare_book(directory, [], output, { ...options, update: previous }, correction);
}

function region_in_group(regionId: string, group: string): boolean {
  // 所有子格编号都保留原气泡组的完整前缀。
  return regionId === group || regionId.startsWith(group + "-");
}

async function prepare_book(
  directory: string,
  selected: ImageHelperRequest<"prepare">["selected"],
  output: string,
  options: PrepareOptions,
  correction?: ImageBubblePartition,
) {
  const { device = "gpu", update } = options;
  if (device !== "cpu" && device !== "gpu") throw new Error("Invalid image device");
  const root = path.resolve(directory);
  const target = path.resolve(output);
  if (fs.exists(target)) throw new Error("Image package work directory already exists");

  const stage = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}`);
  const packageDirectory = path.join(stage, "package");
  const previousDirectory = update ? path.resolve(update, "package") : undefined;
  await fs.make_dir_async(packageDirectory);
  try {
    const previous = previousDirectory && (await validate_package(previousDirectory));
    const partitionFile = update && path.resolve(update, "partitions.json");
    let partitions: ImageBubblePartition[] =
      partitionFile && fs.exists(partitionFile) ? JSON.parse(fs.read_text_file(partitionFile)) : [];
    const targetPage =
      correction &&
      previous &&
      previous.book.pages.find((page) => page.pageId === correction.pageId);
    const affected = new Set(
      targetPage && correction
        ? targetPage.regions
            .filter(({ regionId }) => region_in_group(regionId, correction.group))
            .map(({ regionId }) => regionId)
        : [],
    );
    if (correction) {
      if (!affected.size) throw new Error("Bubble group is missing from the prepared image");
      partitions = partitions.filter(
        (part) => part.pageId !== correction.pageId || part.group !== correction.group,
      );
      partitions.push(correction);
    } else if (previous && !selected.length) throw new Error("No image patch selected for update");

    const previousPages = new Map(
      previous ? previous.book.pages.map((page) => [page.pageId, page]) : [],
    );
    const requested = selected.flatMap((pick) => {
      const region = previousPages
        .get(pick.pageId)
        ?.regions.find(({ regionId }) => regionId === pick.regionId);
      return region?.parts
        ? region.parts.map((regionId) => ({
            pageId: pick.pageId,
            regionId,
            ...(pick.contour ? { contour: true } : {}),
          }))
        : [pick];
    });
    const prepared = await pixels(
      "prepare",
      {
        root,
        output: packageDirectory,
        selected: requested,
        partitions,
        variants: !previous || correction !== undefined,
        ...(correction && targetPage
          ? {
              repartition: { pageId: correction.pageId, group: correction.group },
              reserved: targetPage.regions
                .filter(({ regionId }) => !affected.has(regionId))
                .map(({ box }) => box),
            }
          : {}),
      },
      device,
    );
    let records = read_image_records(prepared.records);
    let book = read_image_book({ bookId: randomUUID(), pages: prepared.pages }, records);
    const regionIds = correction
      ? book.pages.flatMap((page) =>
          page.regions.filter((region) => !region.parts).map(({ regionId }) => regionId),
        )
      : undefined;
    if (previous && previousDirectory) {
      const pages = new Map(book.pages.map((page) => [page.pageId, page]));
      if (pages.size !== previous.book.pages.length)
        throw new Error("Image update requires the same scan");
      for (const page of previous.book.pages) {
        const next = pages.get(page.pageId);
        if (!next || next.sha256 !== page.sha256 || next.relativePath !== page.relativePath)
          throw new Error("Image update requires the same scan");

        const replacements = new Map(next.regions.map((region) => [region.regionId, region]));
        const retained: ImageRegion[] = [];
        for (const region of page.regions) {
          if (page.pageId === correction?.pageId && affected.has(region.regionId)) continue;
          const replacement = replacements.get(region.regionId);
          if (replacement) {
            replacements.delete(region.regionId);
            region.patch = replacement.patch;
            region.backgroundColor = replacement.backgroundColor;
          } else if (region.patch) {
            const destination = path.join(packageDirectory, region.patch.path);
            await fs.make_dir_async(path.dirname(destination));
            fs.copy_file(path.join(previousDirectory, region.patch.path), destination);
          }
          retained.push(region);
        }
        if (page.pageId === correction?.pageId) {
          const start = page.regions.findIndex(({ regionId }) => affected.has(regionId));
          retained.splice(start, 0, ...replacements.values());
        } else if (replacements.size) throw new Error("Image patch update contains a new region");
        page.regions = retained;
      }
      if (correction) {
        const oldRecords = new Map<string, ImageRecord>();
        for (const record of previous.records)
          if (record.pageId === correction.pageId && affected.has(record.regionId))
            oldRecords.set(record.regionId, record);
        records = records.map((record) => oldRecords.get(record.regionId) ?? record);
        let inserted = false;
        const replacements = records;
        records = previous.records.flatMap((record) => {
          if (record.pageId !== correction.pageId || !affected.has(record.regionId))
            return [record];
          if (inserted) return [];
          inserted = true;
          return replacements;
        });
      } else records = previous.records;
      book = read_image_book(previous.book, records);
    }
    await fs.make_dir_async(path.join(packageDirectory, "originals"));
    for (const { original } of book.pages)
      fs.copy_file(
        path.join(previousDirectory ?? root, original),
        path.join(packageDirectory, original),
      );
    await fs.write_file(path.join(packageDirectory, "image.json"), JSON.stringify(book));
    await fs.write_file(path.join(packageDirectory, "items.json"), JSON.stringify(records));
    // 后续局部消字仍可用同一次扫描定位新格。纠错记录留在工作目录。
    if (partitions.length)
      await fs.write_file(path.join(stage, "partitions.json"), JSON.stringify(partitions));
    fs.rename(stage, target);
    return {
      directory: target,
      pages: book.pages.length,
      items: records.length,
      ...(regionIds && { regionIds }),
    };
  } finally {
    await fs.remove_async(stage, { recursive: true, force: true });
  }
}
