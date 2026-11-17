import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { default_native_fs as fs, type NativeFs } from "../../../native/native-fs";
import type { ImageOutputAsset } from "../../../shared/image";
import type { ImageClean, ImagePage } from "../../../shared/image-package";
import type { ImagePixelHost } from "../../../shared/image-helper";
import {
  IMAGE_TEXT_RULES,
  normalize_image_text,
  type ImageTextGeometryRegion,
  type ImageTextHost,
  type ImageTextInput,
  type ImageTextPage,
} from "../../../shared/image-text";
import { normalize_image_to_png } from "./image-pixels";
import { build_image_text_input } from "./image-format";

type ImageOutputEntry = ImageOutputAsset["files"][number]["entries"][number];
type ImageOutputReason = ImageOutputEntry["reasons"][number];

const edge = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/** 从 OCR 四边形读取真实面积、质心和短边字号。 */
function source_box_metrics(box: ImagePage["textBoxes"][number]["coreBox"]): {
  area: number;
  center: [number, number];
  size: number;
} {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < box.length; index++) {
    const current = box[index]!;
    const next = box[(index + 1) % box.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  const area = Math.abs(twiceArea) / 2;
  if (!area) throw new Error("Source text box has no area");
  return {
    area,
    center: [x / (3 * twiceArea), y / (3 * twiceArea)],
    size: Math.min(edge(box[0]!, box[1]!), edge(box[0]!, box[3]!)),
  };
}

/** 聚合视觉块的源文字尺度，坐标转换为块内坐标。 */
function source_layout(
  page: ImagePage,
  direction: ImagePage["regions"][number]["direction"],
  block: ImageTextGeometryRegion["candidates"][number]["blocks"][number],
) {
  const ids = new Set(block.sourceTextBoxIds);
  const boxes = page.textBoxes.filter((box) => ids.has(box.textBoxId));
  if (boxes.length !== ids.size) throw new Error("Missing source text box for layout block");
  const metrics = boxes.map((box) => source_box_metrics(box.coreBox));
  const axis = direction === "vertical-rl" ? 0 : 1;
  const centers = metrics.map((metric) => metric.center[axis]).sort((a, b) => a - b);
  const pitches = centers.slice(1).map((value, index) => value - centers[index]!);
  pitches.sort((a, b) => a - b);
  const sizes = metrics.map((metric) => metric.size).sort((a, b) => a - b);
  const sourceEnvelopeArea = metrics.reduce((sum, metric) => sum + metric.area, 0);
  const [blockX, blockY] = block.box;
  return {
    preferredFontSize: Math.max(
      IMAGE_TEXT_RULES.minimumFontSize,
      Math.round(
        pitches.length
          ? pitches[Math.floor(pitches.length / 2)]! / IMAGE_TEXT_RULES.lineHeight
          : sizes[Math.floor(sizes.length / 2)]!,
      ),
    ),
    sourceEnvelopeArea,
    sourceCenter: [
      metrics.reduce((sum, metric) => sum + metric.center[0] * metric.area, 0) /
        sourceEnvelopeArea -
        blockX,
      metrics.reduce((sum, metric) => sum + metric.center[1] * metric.area, 0) /
        sourceEnvelopeArea -
        blockY,
    ] as [number, number],
  };
}

function entry(
  regionId: string | undefined,
  status: ImageOutputEntry["status"],
  output: ImageOutputEntry["output"],
  reasons: ImageOutputReason[] = [],
): ImageOutputEntry {
  return {
    ...(regionId ? { region_id: regionId } : {}),
    status,
    output,
    reasons,
  };
}

/** 后端文件生成直接拥有图片排版、原文回退、源格式编码和结果事实。 */
export class ImageOutputService {
  public constructor(
    private readonly textHost: ImageTextHost,
    private readonly pixelHost: ImagePixelHost,
    private readonly nativeFs: NativeFs = fs,
  ) {}

  /** 图片域统一遍历资产，最终输出与 QA 只切换区域呈现。 */
  public async write_assets(options: {
    assetPaths: readonly string[];
    items: readonly Item[];
    readAsset: (assetPath: string) => Uint8Array | null | Promise<Uint8Array | null>;
    outputRoot: string;
    claimedPaths: Set<string>;
    qa?: boolean;
  }): Promise<ImageOutputAsset[]> {
    const outputs: ImageOutputAsset[] = [];
    for (const assetPath of options.assetPaths) {
      const content = await options.readAsset(assetPath);
      if (content === null)
        throw new AppError("file.not_found", { public_details: { file: assetPath } });
      outputs.push(
        await this.write_asset({
          assetPath,
          content,
          items: options.items.filter((item) => item.file_path === assetPath),
          outputRoot: options.outputRoot,
          claimedPaths: options.claimedPaths,
          ...(options.qa === undefined ? {} : { qa: options.qa }),
        }),
      );
    }
    return outputs;
  }

  /** 每个源页面写出一个成品；内部计算失败终止本次图片能力。 */
  public async write_asset(options: {
    assetPath: string;
    content: Uint8Array;
    items: readonly Item[];
    outputRoot: string;
    claimedPaths: Set<string>;
    qa?: boolean;
  }): Promise<ImageOutputAsset> {
    const prepared = await build_image_text_input(
      options.content,
      options.items,
      options.assetPath,
    );
    const assetRoot = options.assetPath.replace(/\.image$/iu, "");
    const work = path.join(options.outputRoot, `.image-${randomUUID()}`);
    const files = [];
    await this.nativeFs.make_dir_async(work);
    try {
      for (const [name, member] of prepared.members) {
        await this.nativeFs.write_file(
          path.join(work, ...name.split("/")),
          await member.async("uint8array"),
        );
      }
      for (const [pageIndex, page] of prepared.book.pages.entries()) {
        const outputPath = path.join(
          options.outputRoot,
          assetRoot,
          ...page.relativePath.split("/"),
        );
        const reportPath = path.posix.join(assetRoot.replaceAll("\\", "/"), page.relativePath);
        const outputKey = reportPath.toLocaleLowerCase("en-US");
        if (options.claimedPaths.has(outputKey))
          throw new Error(`Duplicate output path: ${reportPath}`);
        options.claimedPaths.add(outputKey);
        const originalBytes = this.nativeFs.read_file(path.join(work, page.original));
        const normalized = await normalize_image_to_png(originalBytes);
        const originalPath = path.join(work, `normalized-${page.pageId}.png`);
        await this.nativeFs.write_file(originalPath, normalized.png);
        files.push({
          path: reportPath,
          entries: await this.render_page({
            page,
            clean: prepared.clean.pages[pageIndex]!,
            input: prepared.input,
            work,
            originalPath,
            outputPath,
            qa: options.qa ?? false,
          }),
        });
      }
      return { asset_path: options.assetPath, files };
    } finally {
      await this.nativeFs.remove_async(work, { recursive: true, force: true });
    }
  }

  /** 按区域生成覆盖层并交给像素 helper 合成，失败区域保留原文。 */
  private async render_page(options: {
    page: ImagePage;
    clean: ImageClean["pages"][number];
    input: ImageTextInput;
    work: string;
    originalPath: string;
    outputPath: string;
    qa: boolean;
  }): Promise<ImageOutputEntry[]> {
    const { page, clean, input, work } = options;
    const records = input.records.filter((record) => record.pageId === page.pageId);
    const recordsById = new Map(records.map((record) => [record.regionId, record]));
    const cleanById = new Map(clean.regions.map((region) => [region.regionId, region]));
    const renderRegions = page.regions.filter((region) => {
      const record = recordsById.get(region.regionId)!;
      return (
        cleanById.get(region.regionId)!.status === "cleaned" &&
        record.output === "translated" &&
        record.text !== null &&
        record.text.trim().length > 0
      );
    });
    const geometry = renderRegions.length
      ? await this.pixelHost("text_layout", {
          root: work,
          page: { ...page, regions: renderRegions },
          maximumBytes: IMAGE_TEXT_RULES.maximumMaterialBytes,
        })
      : [];
    const geometryById = new Map(geometry.map((region) => [region.regionId, region]));
    const hostPage: ImageTextPage = {
      pageId: page.pageId,
      width: page.width,
      height: page.height,
      regions: [],
    };
    for (const region of renderRegions) {
      const record = recordsById.get(region.regionId)!;
      const text = record.text!;
      const shape = geometryById.get(region.regionId);
      if (!shape) throw new Error("Missing image text geometry");
      hostPage.regions.push({
        regionId: region.regionId,
        text: normalize_image_text(text),
        direction: region.direction,
        fill: { color: region.backgroundColor },
        candidates: shape.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          blocks: candidate.blocks.map((block) => ({
            blockId: block.blockId,
            box: block.box,
            distance: block.distance,
            ...source_layout(page, region.direction, block),
          })),
        })),
      });
    }
    const paint = hostPage.regions.length
      ? await this.textHost({ kind: "render_image_text_page", page: hostPage })
      : [];
    const entries: ImageOutputEntry[] = [];
    const fallbackRegionIds: string[] = [];
    for (const region of page.regions) {
      const cleanRegion = cleanById.get(region.regionId)!;
      const record = recordsById.get(region.regionId)!;
      if (record.output === "original") {
        fallbackRegionIds.push(region.regionId);
        entries.push(entry(region.regionId, "success", "original"));
        continue;
      }
      if (cleanRegion.status === "failed") {
        fallbackRegionIds.push(region.regionId);
        entries.push(entry(region.regionId, "failure", "original", [{ code: "erase_failed" }]));
        continue;
      }
      const text = record.text;
      const paints = paint.filter((item) => item.result.regionId === region.regionId);
      if (record.output === null || text === null) {
        fallbackRegionIds.push(region.regionId);
        entries.push(
          entry(region.regionId, "failure", "original", [{ code: "translation_incomplete" }]),
        );
        continue;
      }
      if (!text.trim()) {
        entries.push(entry(region.regionId, "success", "translated"));
        continue;
      }
      const failed = paints.find((item) => item.result.renderStatus === "failure");
      if (failed?.result.renderStatus === "failure") {
        fallbackRegionIds.push(region.regionId);
        entries.push(
          entry(region.regionId, "failure", "original", [{ code: failed.result.reason }]),
        );
        continue;
      }
      if (!paints.length) throw new Error("Missing image text result region");
      entries.push(entry(region.regionId, "success", "translated"));
    }
    const paintPath = path.join(work, `paint-${page.pageId}.json`);
    await this.nativeFs.write_file(paintPath, JSON.stringify(paint));
    const previewPath = path.join(work, `preview-${page.pageId}.png`);
    await this.pixelHost("text_compose", {
      root: work,
      page,
      source: path.join(work, clean.clean),
      original: options.originalPath,
      cleanRegions: clean.regions,
      fallbackRegionIds,
      paint: paintPath,
      output: previewPath,
    });
    const encodedSource = options.qa ? path.join(work, `qa-${page.pageId}.png`) : previewPath;
    if (options.qa)
      await this.pixelHost("qa_preview", {
        root: work,
        page,
        source: previewPath,
        entries,
        output: encodedSource,
      });
    await this.pixelHost("encode_output", {
      source: encodedSource,
      output: options.outputPath,
      extension: path.extname(page.relativePath),
    });
    return entries;
  }
}
