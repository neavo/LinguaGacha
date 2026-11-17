import { randomUUID } from "node:crypto";
import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import type {
  ImageBook,
  ImageClean,
  ImagePage,
  ImageQualityResult,
  ImageRecord,
} from "../../../shared/image";
import {
  image_sha256,
  validate_image_book,
  validate_image_clean,
} from "../../file/image/image-format";
import { image_metadata } from "../../file/image/image-metadata";
import { normalize_image_to_png } from "../../file/image/image-pixels";
import { INFERENCE_DEPENDENCIES } from "../inference/environment";
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
  ImageBook,
  ImageClean,
  ImageCleanPage,
  ImageCleanRegion,
  ImagePage,
  ImageOutputReport,
  ImageOutputSummary,
  ImageQualityResult,
  ImageRecord,
  ImageRegion,
} from "../../../shared/image";

export type ImageSource = { path: string; relativePath: string };
export type ImageCreateResult = {
  path: string;
  diagnostics: string;
  pages: {
    pageId: string;
    preview: string;
    detected: number;
    regions: number;
    failures: { regionId: string; error: string }[];
  }[];
};

type CreatedPage = {
  page: ImagePage;
  records: ImageRecord[];
  clean: ImageClean["pages"][number];
  diagnostics: Omit<ImageCreateResult["pages"][number], "pageId">;
};

/** 使用当前工程状态生成整页图片 QA 预览。 */
export async function generateQA(): Promise<ImageQualityResult> {
  const result = await workspace_requests().call({ kind: "generate_image_qa" });
  if (
    typeof result !== "object" ||
    result === null ||
    !("output_path" in result) ||
    !("report" in result)
  )
    throw new Error("Invalid generate_image_qa response.");
  return result as ImageQualityResult;
}

/**
 * 整册在一个 helper 与一个推理 Worker 内完成检测、OCR、分区、消字和封包。
 * 成功后只保留 `.image` 与同名诊断目录，不暴露中间事务状态。
 */
export async function createImage(
  sources: readonly ImageSource[],
  output: string,
  device: ImageDevice = "gpu",
): Promise<ImageCreateResult> {
  if (sources.length === 0) throw new Error("At least one source image is required");
  if (device !== "cpu" && device !== "gpu") throw new Error("Invalid image device");
  const target = path.resolve(output);
  const diagnostics = `${target}.diagnostics`;
  if (fs.exists(target) || fs.exists(diagnostics))
    throw new Error("Image output or diagnostics already exists");
  await fs.make_dir_async(path.dirname(target));
  const stage = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.make_dir_async(stage);
  let diagnosticsCommitted = false;
  try {
    const pageSpecs = [];
    for (const source of sources) {
      const bytes = fs.read_file(source.path);
      const metadata = image_metadata(bytes);
      const pageId = randomUUID();
      const original = `originals/${pageId}${metadata.extension}`;
      fs.write_file_atomic(path.join(stage, original), bytes);
      const normalized = await normalize_image_to_png(bytes);
      const normalizedPath = path.join(stage, "normalized", `${pageId}.png`);
      await fs.write_file(normalizedPath, normalized.png);
      pageSpecs.push({
        pageId,
        relativePath: source.relativePath.replaceAll("\\", "/"),
        original,
        sha256: image_sha256(bytes),
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        source: normalizedPath,
      });
    }
    const created = (await pixels("create", { pages: pageSpecs, output: stage }, device)) as {
      pages: CreatedPage[];
    };
    if (!Array.isArray(created.pages) || created.pages.length !== pageSpecs.length)
      throw new Error("Invalid image creation result");
    const book: ImageBook = { bookId: randomUUID(), pages: created.pages.map((item) => item.page) };
    const records = created.pages.flatMap((item) => item.records);
    const clean: ImageClean = {
      bookId: book.bookId,
      pages: created.pages.map((item) => item.clean),
    };
    validate_image_book(book, records);
    validate_image_clean(clean, book);
    const members = [
      ...book.pages.map((page) => page.original),
      ...book.pages.flatMap((page) => page.regions.map((region) => region.layoutArea.path)),
      ...clean.pages.map((page) => page.clean),
      ...clean.pages.flatMap((page) =>
        page.regions.flatMap((region) => (region.eraseMask ? [region.eraseMask] : [])),
      ),
    ];
    await pixels("pack", {
      output: temporary,
      book,
      records,
      clean,
      sources: Object.fromEntries(members.map((member) => [member, path.join(stage, member)])),
    });
    fs.rename(path.join(stage, "diagnostics"), diagnostics);
    diagnosticsCommitted = true;
    fs.rename(temporary, target);
    return {
      path: target,
      diagnostics,
      pages: created.pages.map(({ page, diagnostics: item }) => ({
        pageId: page.pageId,
        ...item,
        preview: path.join(diagnostics, path.basename(item.preview)),
      })),
    };
  } catch (error) {
    fs.unlink(temporary, { force: true });
    if (diagnosticsCommitted) await fs.remove_async(diagnostics, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.remove_async(stage, { recursive: true, force: true });
  }
}
