import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Item } from "../../../domain/item";
import { AGENT_IMAGE_MAX_EDGE } from "../../../shared/agent-image";
import { AppError } from "../../../shared/error";
import { default_native_fs as fs } from "../../../native/native-fs";
import type { ImagePage, ImageRegion } from "../../../shared/image-package";
import type { ImageHelperRequest, ImagePixelHost } from "../../../shared/image-helper";
import {
  normalize_image_text,
  type ImageTextHost,
  type ImageTextRegion,
} from "../../../shared/image-text";
import { image_metadata } from "./image-metadata";
import { normalize_image_to_png } from "./image-pixels";
import { build_image_text_input, type ImageTextRecord } from "./image-format";

type ImageOutputReason = "layout_no_fit" | "translation_incomplete" | "erase_failed";
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
type ImageLayer = {
  patch: NonNullable<ImageRegion["patch"]>;
  overlay?: { box: ImageTextRegion["box"]; png: string };
};

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
    for (const page of prepared.book.pages) {
      // 附加后缀保留原扩展名，避免同名 PNG 和 JPEG 的 QA 预览冲突。
      const relativePath = options.qa ? `${page.relativePath}.webp` : page.relativePath;
      const reportPath = path.posix.join(assetRoot.replaceAll("\\", "/"), relativePath);
      const outputKey = reportPath.toLocaleLowerCase("en-US");
      if (options.claimedPaths.has(outputKey))
        throw new Error(`Duplicate output path: ${reportPath}`);
      options.claimedPaths.add(outputKey);

      const work = path.join(options.outputRoot, `.image-${randomUUID()}`);
      const stage = async (member: string) => {
        await fs.write_file(
          path.join(work, member),
          await prepared.members.get(member)!.async("uint8array"),
        );
      };
      try {
        files.push({
          path: reportPath,
          entries: await this.render_page({
            page,
            records: recordsByPage.get(page.pageId) ?? [],
            work,
            readOriginal: () => prepared.members.get(page.original)!.async("uint8array"),
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
    records: readonly ImageTextRecord[];
    work: string;
    readOriginal: () => Promise<Uint8Array>;
    output: string;
    qa: boolean;
    stage: (member: string) => Promise<void>;
  }): Promise<ImageOutputEntry[]> {
    const { page, records, work, stage } = options;
    const recordsById = new Map(records.map((record) => [record.regionId, record]));
    const byId = new Map(page.regions.map((region) => [region.regionId, region]));
    const hidden = new Set<string>();
    const conflicts = new Set<string>();
    for (const whole of page.regions) {
      if (!whole.parts) continue;
      const wholeActive = recordsById.get(whole.regionId)!.output !== "original";
      const splitActive = whole.parts.some((id) => recordsById.get(id)!.output !== "original");
      if (wholeActive && splitActive) conflicts.add(whole.regionId);
      if (!wholeActive && splitActive) hidden.add(whole.regionId);
      else for (const id of whole.parts) hidden.add(id);
    }

    const visible = page.regions.filter(({ regionId }) => !hidden.has(regionId));
    const translated: {
      index: number;
      region: ImageRegion;
      patches: ImageLayer["patch"][];
      text: string;
    }[] = [];
    const entries = visible.map((region, index) => {
      const record = recordsById.get(region.regionId)!;
      if (conflicts.has(region.regionId)) return entry(region.regionId, "original");
      if (record.output === "original") return entry(region.regionId, "original");
      // 整泡启用时应用所有子格补丁，子格状态只决定分格版的输出。
      const patches = region.parts?.map((id) => byId.get(id)!.patch) ?? [region.patch];
      if (!patches.every((patch) => patch !== null))
        return entry(region.regionId, "original", "erase_failed");
      if (record.output === null)
        return entry(region.regionId, "original", "translation_incomplete");
      const text = record.text.trim() ? normalize_image_text(record.text) : "";
      translated.push({ index, region, patches, text });
      return entry(region.regionId, "translated");
    });

    const regions = translated.flatMap(({ region, text }) =>
      text
        ? [
            {
              regionId: region.regionId,
              box: region.box,
              direction: region.direction,
              backgroundColor: region.backgroundColor,
              text,
            },
          ]
        : [],
    );
    const paint = regions.length
      ? await this.textHost({
          kind: "render_image_text_page",
          page: { pageId: page.pageId, regions },
        })
      : [];
    const paintById = new Map(paint.map(({ regionId, png }) => [regionId, png]));
    if (paint.length !== regions.length) throw new Error("Unexpected image text result count");
    const layers: ImageLayer[] = [];
    for (const { index, region, patches, text } of translated) {
      const { regionId, box } = region;
      const png = text ? paintById.get(regionId) : null;
      if (png === undefined) throw new Error("Missing image text result region");
      if (text && png === null) {
        entries[index] = entry(regionId, "original", "layout_no_fit");
        continue;
      }
      for (const [index, patch] of patches.entries()) {
        await stage(patch.path);
        // helper 先合成全部补丁，再按区域写一次译文。
        layers.push({
          patch,
          ...(png && index === patches.length - 1 ? { overlay: { box, png } } : {}),
        });
      }
    }
    const bytes = await options.readOriginal();
    // 整页保留原稿时直接复用原字节，避免 JPEG 再编码。
    if (
      !options.qa &&
      !layers.length &&
      (image_metadata(bytes).extension === ".png") === /\.png$/iu.test(options.output)
    ) {
      await fs.write_file(options.output, bytes);
      return entries;
    }
    const original = path.join(work, "original.png");
    await fs.write_file(original, (await normalize_image_to_png(bytes)).png);
    const request: ImageHelperRequest<"text_output"> = {
      root: work,
      original,
      output: options.output,
    };
    if (layers.length) {
      const layersPath = path.join(work, "layers.json");
      await fs.write_file(layersPath, JSON.stringify(layers)); // 位图走临时文件，避免撑大请求帧。
      request.layers = layersPath;
    }
    if (options.qa) {
      const marks = entries.flatMap(({ reasons }, index) => {
        if (!reasons.length) return [];
        const { regionId, box } = visible[index]!;
        const code = reasons[0]!.code;
        return [
          {
            regionId,
            box,
            warning: code === "translation_incomplete",
          },
        ];
      });
      request.qa = { maxEdge: AGENT_IMAGE_MAX_EDGE, marks };
    }
    await this.pixelHost("text_output", request);
    return entries;
  }
}
