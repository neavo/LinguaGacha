import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { TSchema } from "typebox";

import { default_native_fs as fs } from "../../../native/native-fs";
import type { ImageQualityResult } from "../../../shared/image";
import type { ImageHelperResponse } from "../../../shared/image-helper";
import {
  IMAGE_BOOK_SCHEMA,
  IMAGE_CLEAN_SCHEMA,
  IMAGE_RECORDS_SCHEMA,
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
  IMAGE_CLEAN_SCHEMA,
  IMAGE_RECORDS_SCHEMA,
  read_image_book,
  read_image_clean,
  read_image_records,
} from "../../../shared/image-package";
export type {
  ImageBook,
  ImageClean,
  ImageCleanPage,
  ImageCleanRegion,
  ImagePage,
  ImageRecord,
  ImageRegion,
} from "../../../shared/image-package";

export type ImageSource = { path: string; relativePath: string };
export type ImageProcessResult = Readonly<{
  directory: string;
  package_directory: string;
  pages: ImageHelperResponse<"create">["pages"];
}>;

/** 按需呈现当前 `.image` 三个 JSON 的目标形状。 */
export function describe_package(): string {
  return create_schema_renderer(
    new Map<TSchema, string>([
      [IMAGE_BOOK_SCHEMA, "ImageBook"],
      [IMAGE_RECORDS_SCHEMA, "ImageRecords"],
      [IMAGE_CLEAN_SCHEMA, "ImageClean"],
    ]),
  ).declarations();
}

/** Skill 封包前执行与后端相同的当前图片物理契约。 */
export const validate_package = validate_image_package_directory;

/** 使用当前工程状态生成整页图片 QA 预览。 */
export async function generateQA(): Promise<ImageQualityResult> {
  return workspace_requests().call({ kind: "generate_image_qa" });
}

/** 整册共用一个 helper 与推理 Worker，只生成当前图片材料和诊断。 */
export async function processPages(
  sources: readonly ImageSource[],
  directory: string,
  device: ImageDevice = "gpu",
): Promise<ImageProcessResult> {
  if (sources.length === 0) throw new Error("At least one source image is required");
  if (device !== "cpu" && device !== "gpu") throw new Error("Invalid image device");
  const target = path.resolve(directory);
  if (fs.exists(target)) throw new Error("Image work directory already exists");
  await fs.make_dir_async(path.dirname(target));
  const stage = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}`);
  const packageDirectory = path.join(stage, "package");
  const normalizedDirectory = path.join(stage, "normalized");
  await fs.make_dir_async(packageDirectory);
  await fs.make_dir_async(normalizedDirectory);
  try {
    const pageSpecs = [];
    for (const source of sources) {
      const bytes = fs.read_file(source.path);
      const metadata = image_metadata(bytes);
      const pageId = randomUUID();
      const original = `originals/${pageId}${metadata.extension}`;
      fs.write_file_atomic(path.join(packageDirectory, original), bytes);
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
    const created = await pixels("create", { pages: pageSpecs, output: packageDirectory }, device);
    if (created.pages.length !== pageSpecs.length) throw new Error("Invalid image creation result");
    fs.rename(path.join(packageDirectory, "diagnostics"), path.join(stage, "diagnostics"));
    fs.rename(stage, target);
    return {
      directory: target,
      package_directory: path.join(target, "package"),
      pages: created.pages.map((item) => ({
        ...item,
        diagnostics: {
          ...item.diagnostics,
          preview: path.join(target, "diagnostics", path.basename(item.diagnostics.preview)),
        },
      })),
    };
  } finally {
    await fs.remove_async(stage, { recursive: true, force: true });
  }
}
