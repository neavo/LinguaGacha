import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { default_native_fs as fs } from "../../../native/native-fs";
import type {
  ImageBubbleGroup,
  ImageBubblePartition,
  ImageHelperRequest,
  ImageHelperResponse,
} from "../../../shared/image-helper";
import {
  image_layout_area_path,
  read_image_book,
  type ImageRecord,
  type ImageRegion,
} from "../../../shared/image-package";
import {
  read_image_package_manifest,
  validate_image_package_directory,
} from "../../file/image/image-package";
import { normalize_image_to_png } from "../../file/image/image-pixels";
import { INFERENCE_DEPENDENCIES } from "../inference/environment";
import { IMAGE_TEXT_RULES, type ImageTextPaint } from "../../../shared/image-text";
import { workspace_requests } from "../workspace/runtime/request-channel";
import { pixels, type ImageDevice } from "./engine";

export { DeviceFailure } from "../inference/client";
export { queue_image_bubble_layout } from "./bubble-layout";
export { missing_models, prepare_models } from "./models";

export const IMAGE_PIXEL_DEPENDENCIES = [
  `numpy==${INFERENCE_DEPENDENCIES.numpy}`,
  `opencv-python-headless==${INFERENCE_DEPENDENCIES.opencv}`,
] as const;

/** 图片领域显式安装依赖（与共享推理底座和媒体版本保持一致）。 */
export const IMAGE_DEPENDENCIES = Object.freeze({
  npm: [`onnxruntime-node@${INFERENCE_DEPENDENCIES.ort}`],
  python: [...IMAGE_PIXEL_DEPENDENCIES, `pyclipper==${INFERENCE_DEPENDENCIES.pyclipper}`],
});
export { read_image_writeback } from "../../../shared/image-package";
export { read_image_package_manifest } from "../../file/image/image-package";

type ImageSource = { path: string; relativePath: string };
type ImageScanResult = Readonly<{
  directory: string;
  pages: ImageHelperResponse<"scan">["pages"];
}>;

/** Skill 封包前执行与后端相同的当前图片物理契约。 */
export const validate_package = validate_image_package_directory;

/** 整册共享识别会话。选字前只生成原稿、候选区域和预览。 */
async function scanPages(
  script: URL,
  sources: readonly ImageSource[],
  directory: string,
  device: ImageDevice = "gpu",
): Promise<ImageScanResult> {
  if (sources.length === 0) throw new Error("At least one source image is required");
  const target = path.resolve(directory);
  if (fs.exists(target)) throw new Error("Image work directory already exists");
  const stage = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}`);
  const normalizedDirectory = path.join(stage, "normalized");
  await fs.make_dir_async(normalizedDirectory);
  try {
    const pageSpecs = [];
    for (const source of sources) {
      const bytes = fs.read_file(source.path);
      const normalized = await normalize_image_to_png(bytes);
      const pageId = randomUUID();
      const original = `originals/${pageId}${normalized.extension}`;
      await fs.write_file(path.join(stage, original), bytes); // 整册在暂存目录完成后才发布。
      const normalizedPath = path.join(normalizedDirectory, `${pageId}.png`);
      await fs.write_file(normalizedPath, normalized.png);
      pageSpecs.push({
        pageId,
        relativePath: source.relativePath.replaceAll("\\", "/"),
        original,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        width: normalized.width,
        height: normalized.height,
        orientation: normalized.orientation,
        source: normalizedPath,
      });
    }
    const scanned = await pixels(script, "scan", { pages: pageSpecs, output: stage }, device);
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
async function inspectBubbleGroup(
  script: URL,
  directory: string,
  target: ImageBubbleGroup,
  output: string,
) {
  const preview = path.resolve(output);
  if (path.extname(preview).toLowerCase() !== ".png" || fs.exists(preview))
    throw new Error("Bubble preview requires a new PNG path");
  return pixels(script, "inspect_bubble_group", {
    ...target,
    root: path.resolve(directory),
    output: preview,
  });
}

type PrepareOptions = { device?: ImageDevice; update?: string };

/** 只处理已选区域。局部补做沿用已入包的原文与写字框。 */
async function preparePages(
  script: URL,
  directory: string,
  selected: ImageHelperRequest<"prepare">["selected"],
  output: string,
  options: PrepareOptions = {},
) {
  return prepare_book(script, directory, selected, output, options);
}

/** 纠正一个气泡组，生成可原子替换的完整资产。 */
async function repartitionBubbleGroup(
  script: URL,
  directory: string,
  correction: ImageBubblePartition,
  previous: string,
  output: string,
  options: { device?: ImageDevice } = {},
) {
  return prepare_book(script, directory, [], output, { ...options, update: previous }, correction);
}

/** 子格编号保留原气泡组编号及分隔符。 */
function region_in_group(regionId: string, group: string): boolean {
  return regionId === group || regionId.startsWith(group + "-");
}

/** 按原稿身份合并补做结果，整册落盘后一次发布。 */
async function prepare_book(
  script: URL,
  directory: string,
  selected: ImageHelperRequest<"prepare">["selected"],
  output: string,
  options: PrepareOptions,
  correction?: ImageBubblePartition,
) {
  const { device = "gpu", update } = options;
  const root = path.resolve(directory);
  const target = path.resolve(output);
  if (fs.exists(target)) throw new Error("Image package work directory already exists");

  const stage = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}`);
  const packageDirectory = path.join(stage, "package");
  const previousDirectory = update ? path.resolve(update, "package") : undefined;
  await fs.make_dir_async(packageDirectory);
  try {
    const previous = previousDirectory && read_image_package_manifest(previousDirectory);
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
      script,
      "prepare",
      {
        root,
        output: packageDirectory,
        selected: requested,
        partitions,
        variants: !previous || correction !== undefined,
        ...(previousDirectory ? { previous: previousDirectory } : {}),
        ...(correction && targetPage
          ? {
              repartition: { pageId: correction.pageId, group: correction.group },
              reserved: targetPage.regions
                .filter(({ regionId, parts }) => !parts && !affected.has(regionId))
                .map(({ regionId, box }) => ({ regionId, box })),
            }
          : {}),
      },
      device,
    );
    let { records } = prepared;
    let book = { bookId: previous ? previous.book.bookId : randomUUID(), pages: prepared.pages };
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
          if (!region.parts) {
            const member = image_layout_area_path(page.pageId, region.regionId);
            const destination = path.join(packageDirectory, member);
            await fs.make_dir_async(path.dirname(destination));
            fs.copy_file(path.join(previousDirectory, member), destination);
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
      book = previous.book;
    }
    read_image_book(book, records); // 补做结果只携带目标区域，合并后才校验整包。
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

export { AGENT_IMAGE_MAX_EDGE } from "../../../shared/agent-image";
export { normalize_image_text } from "../../../shared/image-text";
export { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
export { normalize_image_to_png };

/** 技能入口固定本次使用的脚本路径，各作业仍共享 SDK 的推理监管。 */
export function create_image_pipeline(script: URL) {
  return {
    scan: scanPages.bind(undefined, script),
    inspectGroup: inspectBubbleGroup.bind(undefined, script),
    prepare: preparePages.bind(undefined, script),
    repartition: repartitionBubbleGroup.bind(undefined, script),
    layout: (job: Omit<ImageHelperRequest<"text_layout">, "maximumBytes">) =>
      pixels(script, "text_layout", {
        ...job,
        maximumBytes: IMAGE_TEXT_RULES.maximumMaterialBytes,
      }),
    compose: (job: ImageHelperRequest<"text_output">) => pixels(script, "text_output", job),
  };
}

/** 与 PDF 打印一样，宿主用临时文件交接结果，SDK 读取后释放。 */
export async function render_image_text_page(file: string): Promise<ImageTextPaint[]> {
  const result = await workspace_requests().call({
    kind: "render_image_text_page",
    path: path.resolve(file),
  });
  try {
    return JSON.parse(fs.read_text_file(result.path));
  } finally {
    fs.unlink(result.path, { force: true });
  }
}
