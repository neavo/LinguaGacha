import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  AGENT_IMAGE_MAX_EDGE,
  ProjectAssetPathIndex,
  normalize_image_to_png,
  read_image_font_sizes,
  read_image_package_manifest,
  read_image_writeback,
  render_image_text_page,
  select_image_regions,
} from "@lg/image";

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
  const scratch = path.join(stage, "scratch");
  const files = [];
  try {
    await mkdir(scratch);
    for (const page of pages) {
      const file = `${assetRoot}/${page.relativePath}`;
      const qa = `${page.relativePath}.webp`;
      const entries = await render_page(
        page,
        byPage.get(page.pageId) ?? [],
        {
          source,
          scratch,
          output: path.join(stage, "translated", file),
          bilingual: path.join(stage, "bilingual", file),
          qa: path.join(stage, "qa", qa),
        },
        pixels,
        sizes,
      );
      files.push({ pageId: page.pageId, path: file, qa, entries });
      console.log(`Image page ${files.length}/${pages.length}: ${file}`);
    }
    const summary = { translated: 0, originals: 0, failures: 0 };
    for (const { entries } of files) {
      for (const entry of entries) {
        if (entry.output === "translated") summary.translated++;
        else summary.originals++;
        if (entry.reason) summary.failures++;
      }
    }
    await rm(scratch, { recursive: true });
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

/** 将当前版式的区域结果同时用于译图和 QA。 */
async function render_page(page, records, paths, { layout, compose }, sizes) {
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
  const paints = new Map();
  if (lettering.length) {
    const material = path.join(paths.scratch, "lettering.json");
    await layout({ root: paths.source, output: material, page, lettering });
    for (const paint of await render_image_text_page(material)) paints.set(paint.regionId, paint);
  }

  const layers = [];
  for (const { region, patches, lettering, entry } of candidates) {
    const paint = paints.get(region.regionId);
    // 宿主漏回结果时中止，避免把待绘字的区域仅消字后发布。
    if (lettering && !paint)
      throw new Error(`Missing lettering for ${page.relativePath} region ${region.regionId}`);
    if (paint?.png === null) {
      entry.reason = "layout_no_fit";
      continue;
    }
    if (paint) entry.fontSize = paint.fontSize;
    const png = paint?.png;
    entry.output = "translated";
    for (const [index, patch] of patches.entries()) {
      // Python 先合成所有补丁，再对每个区域写字一次。
      layers.push(
        png && index === patches.length - 1
          ? { patch, overlay: { box: region.box, png } }
          : { patch },
      );
    }
  }

  const source = path.join(paths.source, page.original);
  const bytes = await readFile(source);
  const { extension, png } = await normalize_image_to_png(bytes);
  const normalized = path.join(paths.scratch, "original.png");
  await writeFile(normalized, png);
  const job = {
    root: paths.source,
    original: normalized,
    bilingual: paths.bilingual,
    qa: {
      path: paths.qa,
      maxEdge: AGENT_IMAGE_MAX_EDGE,
      marks: entries
        .filter(({ reason }) => reason)
        .map(({ regionId, reason }) => ({
          regionId,
          box: regions.get(regionId).box,
          warning: reason === "translation_incomplete",
        })),
    },
  };
  if (!layers.length && (extension === ".png") === /\.png$/iu.test(paths.output)) {
    await mkdir(path.dirname(paths.output), { recursive: true });
    await writeFile(paths.output, bytes); // 保留原图字节，QA 使用旋正后的像素。
  } else job.output = paths.output;
  if (layers.length) {
    // 字层写入文件，避免 PNG 数据超过 Python 通道的帧上限。
    job.layers = path.join(paths.scratch, "layers.json");
    await writeFile(job.layers, JSON.stringify(layers));
  }
  await compose(job);
  return entries;
}
