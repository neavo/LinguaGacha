import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Item } from "../../../domain/item";
import { AGENT_IMAGE_MAX_EDGE } from "../../../shared/agent-image";
import { AppError } from "../../../shared/error";
import { default_native_fs as fs } from "../../../native/native-fs";
import type { ImageClean, ImagePage, ImageRegion } from "../../../shared/image-package";
import type { ImageHelperRequest, ImagePixelHost } from "../../../shared/image-helper";
import {
  IMAGE_TEXT_RULES,
  normalize_image_text,
  type ImageTextHost,
  type ImageTextRegion,
} from "../../../shared/image-text";
import { normalize_image_to_png } from "./image-pixels";
import { build_image_text_input, type ImageTextRecord } from "./image-format";

type ImageOutputReason = "layout_no_fit" | "erase_failed" | "translation_incomplete";
type ImageOutputEntry = {
  region_id: string;
  status: "success" | "failure";
  output: "original" | "translated";
  reasons: { code: ImageOutputReason }[];
};
export type ImageOutputAsset = {
  asset_path: string;
  files: { path: string; entries: ImageOutputEntry[] }[];
};
type ImageLayer = { eraseMask: string; overlay?: { box: ImageTextRegion["box"]; png: string } };

/** 原图输出可以是主动排除，也可以是带原因的区域回退。 */
function entry(
  regionId: string,
  output: ImageOutputEntry["output"],
  reason?: ImageOutputReason,
): ImageOutputEntry {
  return {
    region_id: regionId,
    status: reason ? "failure" : "success",
    output,
    reasons: reason ? [{ code: reason }] : [],
  };
}

/** 后端文件生成直接拥有图片排版、原文回退、源格式编码和结果事实。 */
export class ImageOutputService {
  /** 排版与像素宿主分别负责绘字与成图。 */
  public constructor(
    private readonly textHost: ImageTextHost,
    private readonly pixelHost: ImagePixelHost,
  ) {}

  /** 图片域统一遍历资产，正式输出和 QA 共用译图合成。 */
  public async write_assets(options: {
    assetPaths: readonly string[];
    items: readonly Item[];
    readAsset: (assetPath: string) => Uint8Array | null | Promise<Uint8Array | null>;
    outputRoot: string;
    claimedPaths: Set<string>;
    qa?: boolean;
  }): Promise<ImageOutputAsset[]> {
    const outputs: ImageOutputAsset[] = [];
    const itemsByAsset = Map.groupBy(options.items, (item) => item.file_path);
    for (const assetPath of options.assetPaths) {
      const content = await options.readAsset(assetPath);
      if (content === null)
        throw new AppError("file.not_found", { public_details: { file: assetPath } });
      outputs.push(
        await this.write_asset({
          assetPath,
          content,
          items: itemsByAsset.get(assetPath) ?? [],
          outputRoot: options.outputRoot,
          claimedPaths: options.claimedPaths,
          ...(options.qa === undefined ? {} : { qa: options.qa }),
        }),
      );
    }
    return outputs;
  }

  /** 每个源页面写出一个成品；内部计算失败终止本次图片能力。 */
  private async write_asset(options: {
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
    const files = [];
    const recordsByPage = Map.groupBy(prepared.textRecords, (record) => record.pageId);
    for (const [pageIndex, page] of prepared.book.pages.entries()) {
      // 附加后缀保留原扩展名，避免同名 PNG 和 JPEG 的 QA 预览冲突。
      const relativePath = options.qa ? `${page.relativePath}.webp` : page.relativePath;
      const reportPath = path.posix.join(assetRoot.replaceAll("\\", "/"), relativePath);
      const outputKey = reportPath.toLocaleLowerCase("en-US");
      if (options.claimedPaths.has(outputKey))
        throw new Error(`Duplicate output path: ${reportPath}`);
      options.claimedPaths.add(outputKey);

      const work = path.join(options.outputRoot, `.image-${randomUUID()}`);
      const staged = new Set<string>(); // QA 可复用排版已展开的区域掩码。
      /** 包索引已校验路径和成员全集，按需展开并复用同一成员。 */
      const stage = async (member: string) => {
        const destination = path.join(work, member);
        if (!staged.has(member)) {
          await fs.write_file(destination, await prepared.members.get(member)!.async("uint8array"));
          staged.add(member);
        }
        return destination;
      };
      try {
        const bytes = await prepared.members.get(page.original)!.async("uint8array");
        const original = path.join(work, "original.png");
        await fs.write_file(original, (await normalize_image_to_png(bytes)).png);
        files.push({
          path: reportPath,
          entries: await this.render_page({
            page,
            clean: prepared.clean.pages[pageIndex]!,
            records: recordsByPage.get(page.pageId) ?? [],
            work,
            original,
            output: path.join(options.outputRoot, reportPath),
            qa: options.qa ?? false,
            stage,
          }),
        });
      } finally {
        await fs.remove_async(work, { recursive: true, force: true });
      }
    }
    return { asset_path: options.assetPath, files };
  }

  /** 按区域生成覆盖层并交给像素 helper 合成，失败区域保留原文。 */
  private async render_page(options: {
    page: ImagePage;
    clean: ImageClean["pages"][number];
    records: readonly ImageTextRecord[];
    work: string;
    original: string;
    output: string;
    qa: boolean;
    stage: (member: string) => Promise<string>;
  }): Promise<ImageOutputEntry[]> {
    const { page, clean, records, work, stage } = options;
    const recordsById = new Map(records.map((record) => [record.regionId, record]));
    const translated: { index: number; region: ImageRegion; text: string; eraseMask: string }[] =
      [];
    const entries = page.regions.map((region, index) => {
      const record = recordsById.get(region.regionId)!;
      const cleanRegion = clean.regions[index]!; // 包读取器已校验同页区域顺序。
      if (record.output === "original") return entry(region.regionId, "original");
      if (cleanRegion.status === "failed")
        return entry(region.regionId, "original", "erase_failed");
      if (record.output === null)
        return entry(region.regionId, "original", "translation_incomplete");
      const text = record.text.trim() ? normalize_image_text(record.text) : "";
      translated.push({ index, region, text, eraseMask: cleanRegion.eraseMask! });
      return entry(region.regionId, "translated");
    });

    const toRender = translated.filter(({ text }) => text);
    for (const { region } of toRender) await stage(region.layoutArea.path);
    const geometry = toRender.length
      ? await this.pixelHost("text_layout", {
          root: work,
          page: { ...page, regions: toRender.map(({ region }) => region) },
          maximumBytes: IMAGE_TEXT_RULES.maximumMaterialBytes,
        })
      : [];
    const geometryById = new Map(geometry.map((region) => [region.regionId, region]));
    const regions = toRender.map(({ region, text }) => {
      const shape = geometryById.get(region.regionId);
      if (!shape) throw new Error("Missing image text geometry");
      return {
        ...shape,
        text,
        direction: region.direction,
        kind: region.kind,
        backgroundColor: region.backgroundColor,
      };
    });
    const paint = regions.length
      ? await this.textHost({
          kind: "render_image_text_page",
          page: { pageId: page.pageId, regions },
        })
      : [];
    const paintById = new Map(paint.map(({ regionId, png }) => [regionId, png]));
    if (paint.length !== regions.length) throw new Error("Unexpected image text result count");
    const layers: ImageLayer[] = [];
    for (const {
      index,
      region: { regionId },
      text,
      eraseMask,
    } of translated) {
      // 完成空正文只应用消字层，原图输出的区域不进入合成清单。
      if (!text) layers.push({ eraseMask });
      else {
        const png = paintById.get(regionId);
        if (png === undefined) throw new Error("Missing image text result region");
        if (png === null) entries[index] = entry(regionId, "original", "layout_no_fit");
        else layers.push({ eraseMask, overlay: { box: geometryById.get(regionId)!.box, png } });
      }
    }
    const request: ImageHelperRequest<"text_output"> = {
      root: work,
      original: options.original,
      output: options.output,
    };
    if (layers.length) {
      for (const { eraseMask } of layers) await stage(eraseMask);
      const layersPath = path.join(work, "layers.json");
      await fs.write_file(layersPath, JSON.stringify(layers)); // 位图走临时文件，避免撑大请求帧。
      request.composition = { clean: await stage(clean.clean), layers: layersPath };
    }
    if (options.qa) {
      const marks = entries.flatMap((entry, index) => {
        if (entry.status !== "failure") return [];
        const { regionId, layoutArea } = page.regions[index]!;
        return [
          {
            regionId,
            layoutArea: layoutArea.path,
            incomplete: entry.reasons.some(({ code }) => code === "translation_incomplete"),
          },
        ];
      });
      for (const { layoutArea } of marks) await stage(layoutArea);
      request.qa = { maxEdge: AGENT_IMAGE_MAX_EDGE, marks };
    }
    await this.pixelHost("text_output", request);
    return entries;
  }
}
