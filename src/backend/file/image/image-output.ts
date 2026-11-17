import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Item } from "../../../domain/item";
import { default_native_fs as fs, type NativeFs } from "../../../native/native-fs";
import type { ImageClean, ImagePage, ImageRegion } from "../../../shared/image";
import {
  IMAGE_TEXT_RULES,
  normalize_image_text,
  type ImageTextHost,
  type ImageTextInput,
  type ImageTextPage,
} from "../../../shared/image-text";
import { normalize_image_to_png } from "./image-pixels";
import { build_image_text_input } from "./image-format";

export type ImageOutputReasonCode =
  | "tight_margin"
  | "off_center"
  | "small_font"
  | "layout_no_fit"
  | "outside_layout_area"
  | "erase_failed"
  | "unreadable"
  | "page_output_failed"
  | "translation_incomplete";
type ImageOutputReason = { code: ImageOutputReasonCode; detail?: string };
type ImageOutputEntry = {
  regionId?: string;
  status: "success" | "warning" | "failure";
  reasons: ImageOutputReason[];
  fallback?: "original";
};
export type ImageOutputAsset = {
  assetPath: string;
  files: { path: string; entries: ImageOutputEntry[] }[];
};

export type ImagePixelHost = (
  command: "text_layout" | "text_compose" | "encode_output",
  input: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

type GeometryRegion = Pick<ImageTextPage["regions"][number], "regionId" | "candidates">;

const center = (box: ImagePage["textBoxes"][number]["coreBox"]): [number, number] => [
  box.reduce((sum, point) => sum + point[0], 0) / box.length,
  box.reduce((sum, point) => sum + point[1], 0) / box.length,
];
const edge = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

function source_layout(page: ImagePage, region: ImageRegion) {
  const ids = new Set(region.textBoxIds);
  const boxes = page.textBoxes.filter((box) => ids.has(box.textBoxId));
  if (!boxes.length) throw new Error(`Region has no source text boxes: ${region.regionId}`);
  if (boxes.length === 1) {
    const box = boxes[0]!.coreBox;
    return {
      preferredFontSize: Math.max(
        IMAGE_TEXT_RULES.minimumFontSize,
        Math.round(Math.min(edge(box[0]!, box[1]!), edge(box[0]!, box[3]!))),
      ),
      sourceLineCount: 1,
    };
  }
  const axis = region.direction === "vertical-rl" ? 0 : 1;
  const centers = boxes.map((box) => center(box.coreBox)[axis]).sort((a, b) => a - b);
  const pitches = centers.slice(1).map((value, index) => value - centers[index]!);
  pitches.sort((a, b) => a - b);
  return {
    preferredFontSize: Math.max(
      IMAGE_TEXT_RULES.minimumFontSize,
      Math.round(pitches[Math.floor(pitches.length / 2)]! / IMAGE_TEXT_RULES.lineHeight),
    ),
    sourceLineCount: boxes.length,
  };
}

function entry(
  regionId: string | undefined,
  status: ImageOutputEntry["status"],
  reasons: ImageOutputReason[] = [],
  fallback = false,
): ImageOutputEntry {
  return {
    ...(regionId ? { regionId } : {}),
    status,
    reasons,
    ...(fallback ? { fallback: "original" as const } : {}),
  };
}

/** 后端文件生成直接拥有图片排版、原文回退、源格式编码和结果事实。 */
export class ImageOutputService {
  public constructor(
    private readonly textHost: ImageTextHost,
    private readonly pixelHost: ImagePixelHost,
    private readonly nativeFs: NativeFs = fs,
  ) {}

  /** 每个源页面写出一个成品；页面计算失败时原样复制该页。 */
  public async write_asset(options: {
    assetPath: string;
    content: Uint8Array;
    items: readonly Item[];
    outputRoot: string;
    claimedPaths: Set<string>;
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
        try {
          files.push({
            path: reportPath,
            entries: await this.render_page({
              page,
              clean: prepared.clean.pages[pageIndex]!,
              input: prepared.input,
              work,
              originalPath,
              outputPath,
            }),
          });
        } catch (cause) {
          await this.nativeFs.write_file(outputPath, originalBytes);
          files.push({
            path: reportPath,
            entries: [
              entry(
                undefined,
                "failure",
                [
                  {
                    code: "page_output_failed",
                    detail: cause instanceof Error ? cause.message : String(cause),
                  },
                ],
                true,
              ),
            ],
          });
        }
      }
      return { assetPath: options.assetPath, files };
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
  }): Promise<ImageOutputEntry[]> {
    const { page, clean, input, work } = options;
    const geometry = (await this.pixelHost("text_layout", {
      root: work,
      page,
      maximumBytes: IMAGE_TEXT_RULES.maximumMaterialBytes,
    })) as GeometryRegion[];
    const geometryById = new Map(geometry.map((region) => [region.regionId, region]));
    const records = input.records.filter((record) => record.pageId === page.pageId);
    const hostPage: ImageTextPage = {
      pageId: page.pageId,
      width: page.width,
      height: page.height,
      regions: [],
    };
    for (const region of page.regions.filter((item) => item.disposition === "translate")) {
      const text = records.find((record) => record.regionId === region.regionId)!.text;
      const shape = geometryById.get(region.regionId);
      if (!shape) throw new Error("Missing image text geometry");
      if (text !== null && text.trim())
        hostPage.regions.push({
          regionId: region.regionId,
          text: normalize_image_text(text),
          direction: region.direction!,
          fill: { color: region.backgroundColor! },
          ...source_layout(page, region),
          candidates: shape.candidates,
        });
    }
    const paint = hostPage.regions.length
      ? await this.textHost({ kind: "render_image_text_page", page: hostPage })
      : [];
    const entries: ImageOutputEntry[] = [];
    const fallbackRegionIds: string[] = [];
    for (const region of page.regions) {
      if (region.disposition === "preserve") {
        const failed = region.preserveReason !== "intentional";
        entries.push(
          entry(
            region.regionId,
            failed ? "failure" : "success",
            failed
              ? [{ code: region.preserveReason === "unreadable" ? "unreadable" : "erase_failed" }]
              : [],
            failed,
          ),
        );
        continue;
      }
      const text = records.find((record) => record.regionId === region.regionId)!.text;
      const paints = paint.filter((item) => item.result.regionId === region.regionId);
      if (text === null) {
        fallbackRegionIds.push(region.regionId);
        entries.push(entry(region.regionId, "failure", [{ code: "translation_incomplete" }], true));
        continue;
      }
      if (!text.trim()) {
        entries.push(entry(region.regionId, "success"));
        continue;
      }
      const failed = paints.find((item) => item.result.renderStatus === "failure");
      if (failed?.result.renderStatus === "failure") {
        fallbackRegionIds.push(region.regionId);
        entries.push(entry(region.regionId, "failure", [{ code: failed.result.reason }], true));
        continue;
      }
      if (!paints.length) throw new Error("Missing image text result region");
      const warnings = [
        ...new Set(
          paints.flatMap((item) =>
            item.result.renderStatus === "warning" ? item.result.reasons : [],
          ),
        ),
      ];
      entries.push(
        entry(
          region.regionId,
          warnings.length ? "warning" : "success",
          warnings.map((code) => ({ code })),
        ),
      );
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
    await this.pixelHost("encode_output", {
      source: previewPath,
      output: options.outputPath,
      extension: path.extname(page.relativePath),
    });
    return entries;
  }
}
