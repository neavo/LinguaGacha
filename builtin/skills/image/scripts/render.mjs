import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  AGENT_IMAGE_MAX_EDGE,
  ProjectAssetPathIndex,
  normalize_image_to_png,
  read_image_package_manifest,
  read_image_writeback,
  render_image_text_page,
} from "@lg/image";

/** 从同一份快照生成译图和整页对照。整册成功后才发布目录。 */
export async function render_book({ asset_path, source, input, output }, pixels) {
  if (!/\.image$/iu.test(asset_path)) throw new Error("Expected an .image asset path");
  const assetRoot = asset_path.replaceAll("\\", "/").slice(0, -".image".length);
  const { book, records } = read_image_package_manifest(source);
  const writeback = read_image_writeback(JSON.parse(await readFile(input, "utf8")), records);
  const byPage = Map.groupBy(writeback, ({ pageId }) => pageId);
  // QA 追加扩展名后可能产生译图目录里没有的文件与目录冲突。
  const outputPaths = new ProjectAssetPathIndex();
  const qaPaths = new ProjectAssetPathIndex();
  for (const { relativePath } of book.pages) {
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
    for (const page of book.pages) {
      const file = `${assetRoot}/${page.relativePath}`;
      const qa = `${page.relativePath}.webp`;
      const entries = await render_page(
        page,
        byPage.get(page.pageId) ?? [],
        {
          source,
          scratch,
          output: path.join(stage, "translated", file),
          qa: path.join(stage, "qa", qa),
        },
        pixels,
      );
      files.push({ path: file, qa, entries });
      console.log(`Image page ${files.length}/${book.pages.length}: ${file}`);
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
      qa_path: path.join(target, "qa"),
      report: { path: path.join(target, "report.json"), pages: files.length, summary },
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** 先裁决启用区域，再把同一份区域结果用于译图和 QA。 */
async function render_page(page, records, paths, { layout, compose }) {
  const decisions = new Map(records.map((record) => [record.regionId, record]));
  const regions = new Map(page.regions.map((region) => [region.regionId, region]));
  const hidden = new Set();
  const conflicts = new Set();
  for (const region of page.regions) {
    if (!region.parts) continue;
    const wholeActive = decisions.get(region.regionId).output !== "original";
    const splitActive = region.parts.some((id) => decisions.get(id).output !== "original");
    if (wholeActive && splitActive) conflicts.add(region.regionId);
    if (!wholeActive && splitActive) hidden.add(region.regionId);
    else for (const id of region.parts) hidden.add(id);
  }

  const entries = [];
  const candidates = [];
  for (const region of page.regions) {
    const { regionId } = region;
    if (hidden.has(regionId)) continue;
    const decision = decisions.get(regionId);
    const entry = { regionId, output: "original" };
    entries.push(entry);
    if (conflicts.has(regionId)) entry.reason = "variant_conflict";
    if (entry.reason || decision.output === "original") continue;
    const patches = region.parts?.map((id) => regions.get(id).patch) ?? [region.patch];
    if (patches.some((patch) => patch === null)) entry.reason = "erase_failed";
    else if (decision.output === null) entry.reason = "translation_incomplete";
    else {
      const { text, fontSize } = decision;
      const lettering = text.trim()
        ? { regionId, text, ...(fontSize !== undefined && { fontSize }) }
        : undefined;
      candidates.push({ region, patches, lettering, entry });
    }
  }

  const lettering = candidates.flatMap(({ lettering }) => (lettering ? [lettering] : []));
  const layersById = new Map();
  if (lettering.length) {
    const material = path.join(paths.scratch, "lettering.json");
    await layout({ root: paths.source, output: material, page, lettering });
    for (const { regionId, png } of await render_image_text_page(material))
      layersById.set(regionId, png);
  }

  const layers = [];
  for (const { region, patches, lettering, entry } of candidates) {
    const png = layersById.get(region.regionId);
    if (lettering && png === undefined)
      throw new Error(`Missing lettering for ${page.relativePath} region ${region.regionId}`);
    if (lettering && png === null) {
      entry.reason = "layout_no_fit";
      continue;
    }
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
