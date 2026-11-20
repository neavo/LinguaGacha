import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  AGENT_IMAGE_MAX_EDGE,
  ProjectAssetPathIndex,
  read_image_font_sizes,
  read_image_package_manifest,
  read_image_writeback,
  render_image_text_page,
  select_image_regions,
} from "@lg/image";

const MAX_BATCH_PAGES = 10; // 素材预算允许时，与 QA 的 10 页分组对齐。
const MAX_BATCH_BYTES = 64_000_000;

/** 从同一份快照生成译图、双语双拼图和整页对照。所有目标页成功后才发布目录。 */
export async function render_book(
  { asset_path, source, input, output, pageIds, fontSizes },
  pixels,
) {
  if (!/\.image$/iu.test(asset_path)) throw new Error("Expected an .image asset path");
  const assetRoot = asset_path.replaceAll("\\", "/").slice(0, -".image".length);
  const { book, records } = read_image_package_manifest(source);
  let pages = book.pages;
  if (pageIds !== undefined) {
    if (!Array.isArray(pageIds) || pageIds.length === 0)
      throw new Error("Expected a non-empty array of image page IDs");
    const requested = new Set(pageIds);
    pages = pages.filter((page) => requested.has(page.pageId));
    if (pages.length !== pageIds.length) throw new Error("Unknown or duplicate image page ID");
  }
  const selected = select_image_regions(book); // 按原稿顺序核对当前版式的写回记录。
  const writeback = read_image_writeback(
    JSON.parse(await readFile(input, "utf8")),
    records.filter(({ pageId, regionId }) => selected.has(pageId + "/" + regionId)),
  );
  const sizes = fontSizes === undefined ? new Map() : read_image_font_sizes(book, fontSizes);
  const byPage = Map.groupBy(writeback, ({ pageId }) => pageId);
  // QA 追加扩展名后可能产生译图目录里没有的文件与目录冲突。
  const outputPaths = new ProjectAssetPathIndex();
  const qaPaths = new ProjectAssetPathIndex();
  for (const { relativePath } of pages) {
    outputPaths.add(`${assetRoot}/${relativePath}`);
    qaPaths.add(`${relativePath}.webp`);
  }

  const target = path.resolve(output);
  if (existsSync(target)) throw new Error(`Image output directory already exists: ${target}`);
  await mkdir(path.dirname(target), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(target), ".image-"));
  const paths = { assetRoot, source, stage, scratch: path.join(stage, "scratch") };
  const files = [];
  try {
    for (const batch of page_batches(pages, byPage, sizes, paths)) {
      await mkdir(paths.scratch);
      const layout = batch.flatMap((plan) => (plan.layout ? [plan.layout] : []));
      if (layout.length) await pixels.layout({ root: source, pages: layout });
      const composition = [];
      for (const plan of batch) composition.push(await prepare_composition(plan, paths));
      await pixels.compose({ root: source, pages: composition });
      await rm(paths.scratch, { recursive: true });
      for (const { report } of batch) {
        files.push(report);
        console.log(`Image page ${files.length}/${pages.length}: ${report.path}`);
      }
    }
    const summary = { translated: 0, originals: 0, failures: 0 };
    for (const { entries } of files) {
      for (const entry of entries) {
        if (entry.output === "translated") summary.translated++;
        else summary.originals++;
        if (entry.reason) summary.failures++;
      }
    }
    await writeFile(
      path.join(stage, "report.json"),
      JSON.stringify({ asset_path, files, summary }, null, 2),
    );
    await rename(stage, target);
    return {
      output_path: path.join(target, "translated"),
      bilingual_output_path: path.join(target, "bilingual"),
      qa_path: path.join(target, "qa"),
      report: { path: path.join(target, "report.json"), pages: files.length, summary },
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** 按页数和预估素材体积限制在途批次，超出批次预算的单页仍按原有单页限制处理。 */
function* page_batches(pages, byPage, sizes, paths) {
  let batch = [];
  let bytes = 0;
  for (const [index, page] of pages.entries()) {
    const plan = plan_page(page, byPage.get(page.pageId) ?? [], sizes, paths, index);
    if (
      batch.length &&
      (batch.length === MAX_BATCH_PAGES || bytes + plan.bytes > MAX_BATCH_BYTES)
    ) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(plan);
    bytes += plan.bytes;
  }
  if (batch.length) yield batch;
}

/** 从当前版式确定区域结果与待绘字清单。 */
function plan_page(page, records, sizes, { assetRoot, scratch }, index) {
  const regions = new Map(page.regions.map((region) => [region.regionId, region]));
  const entries = [];
  const candidates = [];
  for (const decision of records) {
    const { regionId } = decision;
    const region = regions.get(regionId);
    const entry = { regionId, output: "original" };
    entries.push(entry);
    if (decision.output === "original") continue;
    const patches = region.parts?.map((id) => regions.get(id).patch) ?? [region.patch];
    if (patches.some((patch) => patch === null)) entry.reason = "erase_failed";
    else if (decision.output === null) entry.reason = "translation_incomplete";
    else {
      const { text } = decision;
      const size = sizes.get(page.pageId + "/" + regionId);
      const fontSize = size === null ? undefined : (size ?? region.fontSize); // null 只在本次试排恢复自动。
      const lettering = text.trim()
        ? { regionId, text, ...(fontSize !== undefined && { fontSize }) }
        : undefined;
      candidates.push({ region, patches, lettering, entry });
    }
  }

  const lettering = candidates.flatMap(({ lettering }) => (lettering ? [lettering] : []));
  const scratchBase = path.join(scratch, String(index));
  const layout = lettering.length
    ? { output: `${scratchBase}.lettering.json`, page, lettering }
    : undefined;
  // 按 RGBA 和 Base64 距离场估算暂存体积，布局请求计入预算以避免合批撑大通道帧。
  let bytes = page.width * page.height * 4;
  if (layout) {
    bytes += Buffer.byteLength(JSON.stringify(layout));
    for (const { regionId } of lettering) {
      const [, , width, height] = regions.get(regionId).box;
      bytes += Math.ceil((width * height * 4) / 3) * 4;
    }
  }
  const report = {
    pageId: page.pageId,
    path: `${assetRoot}/${page.relativePath}`,
    qa: `${page.relativePath}.webp`,
    entries,
  };
  return { page, regions, candidates, layout, report, bytes, scratchBase };
}

/** 宿主按页绘字，合成时直接读取包内原图。 */
async function prepare_composition(
  { page, regions, candidates, layout, report, scratchBase },
  paths,
) {
  const paints = new Map();
  if (layout) {
    for (const paint of await render_image_text_page(layout.output))
      paints.set(paint.regionId, paint);
  }

  const patches = [];
  const overlays = [];
  for (const { region, patches: regionPatches, lettering, entry } of candidates) {
    const paint = paints.get(region.regionId);
    // 宿主漏回结果时中止，避免把待绘字的区域仅消字后发布。
    if (lettering && !paint)
      throw new Error(`Missing lettering for ${page.relativePath} region ${region.regionId}`);
    if (paint?.png === null) {
      entry.reason = "layout_no_fit";
      continue;
    }
    if (paint) entry.fontSize = paint.fontSize;
    entry.output = "translated";
    patches.push(...regionPatches);
    if (paint?.png) overlays.push({ box: region.box, png: paint.png });
  }

  const job = {
    original: path.join(paths.source, page.original),
    width: page.width,
    height: page.height,
    orientation: page.orientation,
    output: path.join(paths.stage, "translated", report.path),
    bilingual: path.join(paths.stage, "bilingual", report.path),
    qa: {
      path: path.join(paths.stage, "qa", report.qa),
      maxEdge: AGENT_IMAGE_MAX_EDGE,
      marks: report.entries
        .filter(({ reason }) => reason)
        .map(({ regionId, reason }) => ({
          regionId,
          box: regions.get(regionId).box,
          warning: reason === "translation_incomplete",
        })),
    },
  };
  if (patches.length) {
    // 字层写入文件，避免 PNG 数据超过 Python 通道的帧上限。
    job.layers = `${scratchBase}.layers.json`;
    await writeFile(job.layers, JSON.stringify({ patches, overlays }));
  }
  return job;
}
