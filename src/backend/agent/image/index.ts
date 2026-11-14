import { randomUUID } from "node:crypto";
import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import type {
  ImageBook,
  ImageClean,
  ImageCleanPage,
  ImagePage,
  ImagePreserveReason,
  ImageRecord,
  ImageRegion,
} from "../../../shared/image";
import {
  compute_clean_status,
  erase_input_digest,
  image_sha256,
  read_image_package,
  validate_image_book,
  validate_image_clean,
} from "../../file/image/image-format";
import { image_metadata } from "../../file/image/image-metadata";
import { pixels, type ImageDevice } from "./engine";
import {
  ALGORITHM_VERSION,
  EVIDENCE_INDEX_FILE,
  STATE_FILE,
  assert_immutable_pages,
  digest,
  ensure_normalized,
  file_exists,
  load_draft,
  locked,
  normalized_meta_path,
  normalized_path,
  read_json,
  repair_cache_key,
  stage_reviewed_page,
  verify_reviewed_page,
  write_json,
  type Draft,
  type ErasePageResult,
  type PrepareCandidate,
  type PreparePageEvidence,
  type ReviewedPageRef,
  type RunRecord,
} from "./state";

import { INFERENCE_DEPENDENCIES } from "../inference/environment";

export { INFERENCE_DEPENDENCIES };
export { IMAGE_MODELS, missing_models, prepare_models, type ImageModelKind } from "./models";

/** 图片领域显式安装依赖（与共有推理底座与媒体版本保持一致）。 */
export const IMAGE_DEPENDENCIES = Object.freeze({
  npm: [`onnxruntime-node@${INFERENCE_DEPENDENCIES.ort}`],
  python: [
    `numpy==${INFERENCE_DEPENDENCIES.numpy}`,
    `opencv-python-headless==${INFERENCE_DEPENDENCIES.opencv}`,
    "pyclipper==1.4.0",
  ],
});
export type {
  ImageBook,
  ImageClean,
  ImageCleanPage,
  ImageCleanRegion,
  ImagePage,
  ImageRecord,
  ImageRegion,
} from "../../../shared/image";
export type {
  Draft,
  EraseGap,
  ErasePageResult,
  EraseRegionResult,
  PrepareCandidate,
  PreparePageEvidence,
  ReviewRecord,
  ReviewedPageRef,
  RunRecord,
} from "./state";

const UUID_RE = /^[a-f0-9-]{36}$/u;

export type DeliveryPage = {
  pageId: string;
  originalSha256: string;
  inputSha256: string;
  file: string;
  sha256: string;
  preserved: { regionId: string; reason: ImagePreserveReason }[];
};

export type DeliveryManifest = {
  bookId: string;
  status: ImageClean["status"];
  deliverySha256: string;
  pages: DeliveryPage[];
};

async function collect_review_status(directory: string, draft: Draft) {
  return await Promise.all(
    draft.book.pages.map(async (page) => {
      const inputSha256 = erase_input_digest(page);
      try {
        await verify_reviewed_page(directory, draft, page);
        return { pageId: page.pageId, inputSha256, reviewed: true };
      } catch {
        return { pageId: page.pageId, inputSha256, reviewed: false };
      }
    }),
  );
}

/** 第一阶段取证：保留原始字节与身份，通过 shared `manga` + `det` 局部重检产出证据与草稿建议。 */
export async function prepare(options: {
  sources: readonly string[];
  workDirectory: string;
  device?: ImageDevice;
}): Promise<Draft & { evidence: PreparePageEvidence[] }> {
  if (options.sources.length === 0) throw new Error("At least one source image is required");
  const directory = path.resolve(options.workDirectory);
  const device = options.device ?? "cpu";

  return locked(directory, async () => {
    if (file_exists(path.join(directory, STATE_FILE)))
      throw new Error("Image draft already exists");

    const book: ImageBook = { version: 1, bookId: randomUUID(), pages: [] };
    const records: ImageRecord[] = [];
    const pageMeta: {
      pageId: string;
      original: string;
      sha256: string;
      width: number;
      height: number;
      orientation: number;
    }[] = [];

    await fs.make_dir_async(path.join(directory, "originals"));
    for (const source of options.sources) {
      const metadata = image_metadata(fs.read_file(source));
      const pageId = randomUUID();
      const original = `originals/${pageId}${metadata.extension}`;
      const target = path.join(directory, original);
      fs.copy_file(source, target);
      pageMeta.push({
        pageId,
        original,
        sha256: await digest(target),
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
      });
    }

    // 规范化原图先统一落地（复用 MuPDF 规范化编码），确保 EXIF 方向在像素阶段始终一致。
    const stubPages: ImagePage[] = pageMeta.map((p) => ({ ...p, regions: [] }));
    const normalized = await ensure_normalized(directory, stubPages);

    const evidence: PreparePageEvidence[] = [];
    for (const meta of pageMeta) {
      const result = (await pixels(
        "prepare",
        {
          source: normalized.get(meta.pageId)!,
          output: path.join(directory, "evidence", meta.pageId),
        },
        device,
      )) as {
        width: number;
        height: number;
        preview: string;
        previewScale: number;
        crops: Record<string, string>;
        candidates: PrepareCandidate[];
        draftRegions: ImageRegion[];
      };
      book.pages.push({ ...meta, regions: result.draftRegions });
      records.push(
        ...result.draftRegions
          .filter((r) => r.disposition === "translate")
          .map(({ regionId }) => ({ pageId: meta.pageId, regionId, message: "" })),
      );
      evidence.push({
        pageId: meta.pageId,
        width: result.width,
        height: result.height,
        preview: result.preview,
        previewScale: result.previewScale,
        crops: result.crops,
        candidates: result.candidates,
      });
    }

    const draft: Draft = { revision: 0, confirmed: false, book, records, reviewed: {} };
    validate_image_book(book, records, { confirmed: false });
    write_json(path.join(directory, STATE_FILE), draft);
    write_json(path.join(directory, EVIDENCE_INDEX_FILE), evidence);
    return { ...draft, evidence };
  });
}

/** 读取当前草稿、检测证据以及各页已验收状态（`inputSha256` 是否匹配）。 */
export async function read(workDirectory: string) {
  const directory = path.resolve(workDirectory);
  const draft = load_draft(directory);
  const evidenceFile = path.join(directory, EVIDENCE_INDEX_FILE);
  const evidence = file_exists(evidenceFile) ? read_json<PreparePageEvidence[]>(evidenceFile) : [];
  const reviewStatus = await collect_review_status(directory, draft);
  return { ...draft, reviewStatus, evidence };
}

/** 在工作区锁下原子提交确认的区域、消字配置与按阅读顺序排列的原文字段。 */
export async function apply(
  workDirectory: string,
  expectedRevision: number,
  change: { pages: ImagePage[]; records: ImageRecord[]; confirmed: boolean },
): Promise<Draft> {
  const directory = path.resolve(workDirectory);
  return locked(directory, async () => {
    const current = load_draft(directory);
    if (current.revision !== expectedRevision) throw new Error("Stale image draft revision");
    assert_immutable_pages(current.book.pages, change.pages);

    const nextPages = structuredClone(change.pages);
    const nextRecords = structuredClone(change.records);
    validate_image_book({ ...current.book, pages: nextPages }, nextRecords, {
      confirmed: change.confirmed,
    });

    const reviewed: Record<string, ReviewedPageRef> = {};
    for (const page of nextPages) {
      const existing = current.reviewed?.[page.pageId];
      if (existing && existing.inputSha256 === erase_input_digest(page)) {
        reviewed[page.pageId] = existing;
      }
    }

    const next: Draft = {
      ...(current.sourceSha256 ? { sourceSha256: current.sourceSha256 } : {}),
      revision: current.revision + 1,
      confirmed: change.confirmed,
      book: { ...current.book, pages: nextPages },
      records: nextRecords,
      reviewed,
    };
    write_json(path.join(directory, STATE_FILE), next);
    return next;
  });
}

/** 对已确认草稿执行整页消字与掩码生成，产出待 `review` 验收的运行快照，不直接修改 `reviewed/`。 */
export async function erase(options: {
  workDirectory: string;
  expectedRevision: number;
  pageIds?: readonly string[];
  device?: ImageDevice;
}) {
  const directory = path.resolve(options.workDirectory);
  const device = options.device ?? "cpu";

  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (draft.revision !== options.expectedRevision) throw new Error("Stale image draft revision");
    if (!draft.confirmed) throw new Error("Confirm image regions and source text before erasing");

    const byId = new Map(draft.book.pages.map((p) => [p.pageId, p]));
    let targetPages: ImagePage[];
    if (options.pageIds) {
      if (options.pageIds.length === 0) throw new Error("pageIds must not be empty");
      const seen = new Set<string>();
      targetPages = [];
      for (const pageId of options.pageIds) {
        if (seen.has(pageId) || !byId.has(pageId)) throw new Error(`Invalid pageId: ${pageId}`);
        seen.add(pageId);
        targetPages.push(byId.get(pageId)!);
      }
    } else {
      targetPages = draft.book.pages;
    }

    const normalized = await ensure_normalized(directory, targetPages);
    const runId = randomUUID();
    const runDir = path.join(directory, "runs", runId);
    const results: ErasePageResult[] = [];

    for (const page of targetPages) {
      const inputSha256 = erase_input_digest(page);
      const cacheKey = repair_cache_key(inputSha256, device);
      const cacheDir = path.join(directory, "cache", page.pageId, cacheKey);
      const pageRunDir = path.join(runDir, page.pageId);
      const cacheMeta = path.join(cacheDir, "repair.json");

      let cachedResult: ErasePageResult | null = null;
      if (file_exists(cacheMeta)) {
        try {
          const cached = read_json<ErasePageResult>(cacheMeta);
          if (
            cached.ok &&
            cached.clean &&
            cached.cleanSha256 &&
            (await digest(cached.clean)) === cached.cleanSha256
          ) {
            let masksOk = true;
            for (const r of cached.regions) {
              if (r.mask && (!r.maskSha256 || (await digest(r.mask)) !== r.maskSha256)) {
                masksOk = false;
                break;
              }
            }
            if (masksOk) {
              await fs.make_dir_async(path.join(pageRunDir, "masks"));
              const runClean = path.join(pageRunDir, "clean.png");
              const runOverlay = path.join(pageRunDir, "mask-overlay.png");
              fs.copy_file(cached.clean, runClean);
              fs.copy_file(cached.overlay, runOverlay);
              const copiedRegions = cached.regions.map((r) => {
                if (!r.mask) return r;
                const runMask = path.join(pageRunDir, "masks", `${r.regionId}.png`);
                fs.copy_file(r.mask, runMask);
                return { ...r, mask: runMask };
              });
              cachedResult = {
                ...cached,
                clean: runClean,
                overlay: runOverlay,
                regions: copiedRegions,
                cached: true,
              };
            }
          }
        } catch {
          cachedResult = null;
        }
      }

      if (cachedResult) {
        results.push(cachedResult);
        continue;
      }

      const raw = (await pixels(
        "erase",
        { source: normalized.get(page.pageId)!, page, output: pageRunDir },
        device,
      )) as Omit<ErasePageResult, "pageId" | "inputSha256">;

      const entry: ErasePageResult = { pageId: page.pageId, inputSha256, ...raw, cached: false };
      if (entry.ok && entry.clean && entry.cleanSha256) {
        await fs.make_dir_async(path.join(cacheDir, "masks"));
        const cachedClean = path.join(cacheDir, "clean.png");
        const cachedOverlay = path.join(cacheDir, "mask-overlay.png");
        fs.copy_file(entry.clean, cachedClean);
        fs.copy_file(entry.overlay, cachedOverlay);
        const cachedRegions = entry.regions.map((r) => {
          if (!r.mask) return r;
          const dest = path.join(cacheDir, "masks", `${r.regionId}.png`);
          fs.copy_file(r.mask, dest);
          return { ...r, mask: dest };
        });
        write_json(cacheMeta, {
          ...entry,
          clean: cachedClean,
          overlay: cachedOverlay,
          regions: cachedRegions,
        });
      }
      results.push(entry);
    }

    const nextRevision = draft.revision + 1;
    const record: RunRecord = {
      version: ALGORITHM_VERSION,
      runId,
      revision: nextRevision,
      device,
      pages: results,
      decisions: {},
    };
    write_json(path.join(runDir, "run.json"), record);
    write_json(path.join(directory, STATE_FILE), { ...draft, revision: nextRevision });
    return { runId, revision: nextRevision, status: "pending" as const, pages: results };
  });
}

/** 独立审阅验收：全部页校验并固化至不可变 `reviewed/<pageId>/<artifactDigest>/` 后，原子提交草稿引用。 */
export async function review(options: {
  workDirectory: string;
  runId: string;
  expectedRevision: number;
  pages: readonly { pageId: string; decision: "accept" | "reject"; reason?: string }[];
}) {
  if (!UUID_RE.test(options.runId)) throw new Error("Invalid runId");
  if (options.pages.length === 0) throw new Error("At least one page decision is required");
  const directory = path.resolve(options.workDirectory);

  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (!draft.confirmed) throw new Error("Image draft must remain confirmed for review");
    if (draft.revision !== options.expectedRevision) throw new Error("Stale image draft revision");
    const runFile = path.join(directory, "runs", options.runId, "run.json");
    const run = read_json<RunRecord>(runFile);
    if (run.version !== ALGORITHM_VERSION) throw new Error("Image run algorithm version mismatch");

    const draftPages = new Map(draft.book.pages.map((p) => [p.pageId, p]));
    const runPages = new Map(run.pages.map((p) => [p.pageId, p]));
    const seen = new Set<string>();
    const accepted: string[] = [];
    const rejected: { pageId: string; reason?: string }[] = [];
    const verifiedAccepts: {
      pageId: string;
      inputSha256: string;
      cleanSource: string;
      cleanSha256: string;
      regions: Parameters<typeof stage_reviewed_page>[1]["regions"];
    }[] = [];

    // 第一阶段：跨页完整核对输入与产物，任一校验失败时不写任何持久化目录或引用。
    for (const item of options.pages) {
      if (seen.has(item.pageId)) throw new Error(`Duplicate review decision: ${item.pageId}`);
      seen.add(item.pageId);

      const draftPage = draftPages.get(item.pageId);
      const runPage = runPages.get(item.pageId);
      if (!draftPage || !runPage) throw new Error(`Page not found in run: ${item.pageId}`);

      const currentInputSha = erase_input_digest(draftPage);
      if (currentInputSha !== runPage.inputSha256)
        throw new Error(`Stale erase run for page ${item.pageId}; run erase again`);

      if (item.decision === "reject") {
        rejected.push({ pageId: item.pageId, ...(item.reason ? { reason: item.reason } : {}) });
        continue;
      }

      if (!runPage.ok || !runPage.clean || !runPage.cleanSha256)
        throw new Error(`Cannot accept failed or incomplete erase result on page ${item.pageId}`);
      if ((await digest(runPage.clean)) !== runPage.cleanSha256)
        throw new Error(`Erase artifact clean.png tampered on page ${item.pageId}`);

      const runRegions = new Map(runPage.regions.map((r) => [r.regionId, r]));
      if (runRegions.size !== draftPage.regions.length)
        throw new Error(`Run region count mismatch on page ${item.pageId}`);

      const stagedRegions: Parameters<typeof stage_reviewed_page>[1]["regions"][number][] = [];
      for (const draftRegion of draftPage.regions) {
        const region = runRegions.get(draftRegion.regionId);
        if (!region || region.disposition !== draftRegion.disposition)
          throw new Error(`Run region mismatch on ${item.pageId}/${draftRegion.regionId}`);
        if (region.disposition === "preserve") {
          stagedRegions.push({
            regionId: region.regionId,
            disposition: "preserve",
            ...(draftRegion.preserveReason ? { preserveReason: draftRegion.preserveReason } : {}),
          });
          continue;
        }
        if (!region.method || !region.mask || !region.maskSha256)
          throw new Error(`Missing mask artifact for ${item.pageId}/${region.regionId}`);
        if ((await digest(region.mask)) !== region.maskSha256)
          throw new Error(`Erase mask tampered for ${item.pageId}/${region.regionId}`);
        stagedRegions.push({
          regionId: region.regionId,
          disposition: "translate",
          method: region.method,
          maskSource: region.mask,
          maskSha256: region.maskSha256,
        });
      }

      verifiedAccepts.push({
        pageId: item.pageId,
        inputSha256: currentInputSha,
        cleanSource: runPage.clean,
        cleanSha256: runPage.cleanSha256,
        regions: stagedRegions,
      });
    }

    // 第二阶段：逐页落地到不可变内容寻址目录，不覆盖既有成果。
    const nextReviewed: Record<string, ReviewedPageRef> = { ...draft.reviewed };
    for (const page of verifiedAccepts) {
      const { artifactDigest } = await stage_reviewed_page(directory, page);
      nextReviewed[page.pageId] = {
        inputSha256: page.inputSha256,
        artifactDigest,
        runId: options.runId,
      };
      run.decisions[page.pageId] = { decision: "accept" };
      accepted.push(page.pageId);
    }
    for (const item of rejected) {
      run.decisions[item.pageId] = {
        decision: "reject",
        ...(item.reason ? { reason: item.reason } : {}),
      };
      if (nextReviewed[item.pageId]?.runId === options.runId) {
        delete nextReviewed[item.pageId];
      }
    }

    // 第三阶段：原子提交运行决定、草稿验收引用与推进后的工作区修订。
    const nextRevision = draft.revision + 1;
    const nextDraft: Draft = { ...draft, revision: nextRevision, reviewed: nextReviewed };
    write_json(runFile, run);
    write_json(path.join(directory, STATE_FILE), nextDraft);

    const status = await collect_review_status(directory, nextDraft);
    return {
      runId: options.runId,
      revision: nextRevision,
      accepted,
      rejected,
      unreviewedPages: status.filter((s) => !s.reviewed).map((s) => s.pageId),
    };
  });
}

async function build_clean_manifest(
  directory: string,
  draft: Draft,
): Promise<{
  clean: ImageClean;
  sources: Record<string, string>;
}> {
  const cleanPages: ImageCleanPage[] = [];
  const sources: Record<string, string> = {};
  for (const page of draft.book.pages) {
    const {
      review: rev,
      cleanPath,
      maskPaths,
      cleanRegions,
    } = await verify_reviewed_page(directory, draft, page);
    const cleanMember = `clean/${page.pageId}.png`;
    sources[page.original] = path.join(directory, page.original);
    sources[cleanMember] = cleanPath;
    for (const [regionId, maskPath] of maskPaths) {
      sources[`masks/${page.pageId}/${regionId}.png`] = maskPath;
    }
    cleanPages.push({
      pageId: page.pageId,
      clean: cleanMember,
      cleanSha256: rev.cleanSha256,
      inputSha256: rev.inputSha256,
      regions: cleanRegions,
    });
  }
  const clean: ImageClean = {
    version: 1,
    bookId: draft.book.bookId,
    status: compute_clean_status(draft.book),
    pages: cleanPages,
  };
  validate_image_clean(clean, draft.book);
  return { clean, sources };
}

/** 打包 `.image` 资产：要求整书确认且逐页通过验收，离线无模型即可完成。 */
export async function pack(
  workDirectory: string,
  output: string,
): Promise<{ path: string; sourceSha256: string; status: ImageClean["status"] }> {
  const directory = path.resolve(workDirectory);
  const target = path.resolve(output);
  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (!draft.confirmed) throw new Error("Confirm image regions and source text before packaging");
    const { clean, sources } = await build_clean_manifest(directory, draft);
    const normalized = await ensure_normalized(directory, draft.book.pages);

    await fs.make_dir_async(path.dirname(target));
    const temporary = `${target}.${randomUUID()}.tmp`;
    await pixels("pack", {
      root: directory,
      sources,
      normalized: Object.fromEntries(normalized),
      book: draft.book,
      records: draft.records,
      clean,
      output: temporary,
    });
    await read_image_package(fs.read_file(temporary), target);
    fs.rename(temporary, target);
    const sourceSha256 = await digest(target);
    write_json(path.join(directory, STATE_FILE), { ...draft, sourceSha256 });
    return { path: target, sourceSha256, status: clean.status };
  });
}

/** 从工程展开的 `sources/<asset>/` 离线恢复工作区，失效旧规范化缓存并恢复不可变验收产物。 */
export async function restore(sourceDirectory: string, workDirectory: string): Promise<Draft> {
  const source = path.resolve(sourceDirectory);
  const directory = path.resolve(workDirectory);
  return locked(directory, async () => {
    const book = read_json<ImageBook>(path.join(source, "image.json"));
    const records = read_json<ImageRecord[]>(path.join(source, "items.json"));
    const clean = read_json<ImageClean>(path.join(source, "clean.json"));
    const { sourceSha256 } = read_json<{ sourceSha256: string }>(
      path.join(source, "image-source.json"),
    );
    validate_image_book(book, records, { confirmed: true });
    validate_image_clean(clean, book);

    const cleanById = new Map(clean.pages.map((p) => [p.pageId, p]));
    const stageRoot = path.join(directory, `.restore-${randomUUID()}`);
    try {
      // 第一阶段：只读校验全部原稿、底图与掩码摘要，并暂存原稿副本，绝不提前改写现有工作区。
      const stageItems: {
        page: ImagePage;
        stagedOrig: string;
        inputSha256: string;
        cleanSource: string;
        cleanSha256: string;
        regions: Parameters<typeof stage_reviewed_page>[1]["regions"];
      }[] = [];

      for (const page of book.pages) {
        const srcOrig = path.join(source, page.original);
        if ((await digest(srcOrig)) !== page.sha256)
          throw new Error(`Original digest mismatch: ${page.pageId}`);
        const stagedOrig = path.join(stageRoot, page.original);
        fs.copy_file(srcOrig, stagedOrig);
        if ((await digest(stagedOrig)) !== page.sha256)
          throw new Error(`Staged original digest mismatch: ${page.pageId}`);

        const cleanPage = cleanById.get(page.pageId)!;
        const inputSha256 = erase_input_digest(page);
        if (cleanPage.inputSha256 !== inputSha256)
          throw new Error(`Clean inputSha256 mismatch: ${page.pageId}`);
        const srcClean = path.join(source, cleanPage.clean);
        if ((await digest(srcClean)) !== cleanPage.cleanSha256)
          throw new Error(`Clean digest mismatch: ${page.pageId}`);

        const stagedRegions: Parameters<typeof stage_reviewed_page>[1]["regions"][number][] = [];
        for (const cr of cleanPage.regions) {
          if (cr.disposition === "preserve") {
            stagedRegions.push({
              regionId: cr.regionId,
              disposition: "preserve",
              ...(cr.preserveReason ? { preserveReason: cr.preserveReason } : {}),
            });
            continue;
          }
          if (!cr.method || !cr.mask || !cr.maskSha256)
            throw new Error(`Clean region missing method or mask: ${page.pageId}/${cr.regionId}`);
          const srcMask = path.join(source, cr.mask);
          if ((await digest(srcMask)) !== cr.maskSha256)
            throw new Error(`Mask digest mismatch: ${page.pageId}/${cr.regionId}`);
          stagedRegions.push({
            regionId: cr.regionId,
            disposition: "translate",
            method: cr.method,
            maskSource: srcMask,
            maskSha256: cr.maskSha256,
          });
        }

        stageItems.push({
          page,
          stagedOrig,
          inputSha256,
          cleanSource: srcClean,
          cleanSha256: cleanPage.cleanSha256,
          regions: stagedRegions,
        });
      }

      // 第二阶段：全部校验通过后再固化不可变 reviewed 产物，并提交工作区原稿、规范化缓存失效与草稿状态。
      const reviewed: Record<string, ReviewedPageRef> = {};
      for (const item of stageItems) {
        const { artifactDigest } = await stage_reviewed_page(directory, {
          pageId: item.page.pageId,
          inputSha256: item.inputSha256,
          cleanSource: item.cleanSource,
          cleanSha256: item.cleanSha256,
          regions: item.regions,
        });
        reviewed[item.page.pageId] = {
          inputSha256: item.inputSha256,
          artifactDigest,
          runId: "restored",
        };
      }

      // 第三阶段：备份将被改写的目标文件，原子提交原稿/缓存失效/草稿并在任一步失败时完整回滚。
      const backups: { target: string; backup?: string }[] = [];
      const backupTarget = (target: string) => {
        if (backups.some((b) => b.target === target)) return;
        if (file_exists(target)) {
          const backup = path.join(
            stageRoot,
            "backup",
            `${backups.length}-${path.basename(target)}`,
          );
          fs.copy_file(target, backup);
          backups.push({ target, backup });
        } else {
          backups.push({ target });
        }
      };

      const stateFile = path.join(directory, STATE_FILE);
      const normCleanups: string[] = [];
      await fs.make_dir_async(path.join(directory, "originals"));
      for (const item of stageItems) {
        backupTarget(path.join(directory, item.page.original));
        const normPng = normalized_path(directory, item.page.pageId);
        const normMeta = normalized_meta_path(directory, item.page.pageId);
        let keepNormalized = false;
        if (file_exists(normPng) && file_exists(normMeta)) {
          try {
            const meta = read_json<{ sourceSha256: string }>(normMeta);
            keepNormalized = meta.sourceSha256 === item.page.sha256;
          } catch {
            keepNormalized = false;
          }
        }
        if (!keepNormalized) {
          for (const p of [normPng, normMeta]) {
            if (file_exists(p)) {
              backupTarget(p);
              normCleanups.push(p);
            }
          }
        }
      }
      backupTarget(stateFile);

      const draft: Draft = { revision: 0, confirmed: true, book, records, reviewed, sourceSha256 };
      try {
        for (const item of stageItems) {
          fs.copy_file_atomic(item.stagedOrig, path.join(directory, item.page.original));
        }
        for (const p of normCleanups) {
          await fs.remove_async(p, { force: true });
        }
        write_json(stateFile, draft);
      } catch (cause) {
        const rollbackErrors: unknown[] = [];
        for (const entry of [...backups].reverse()) {
          try {
            if (entry.backup) fs.rename(entry.backup, entry.target);
            else await fs.remove_async(entry.target, { force: true });
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [cause, ...rollbackErrors],
            "Restore commit and rollback failed.",
            { cause },
          );
        }
        throw cause;
      }
      return draft;
    } finally {
      await fs.remove_async(stageRoot, { recursive: true, force: true });
    }
  });
}

/** 原子导出第一阶段自然页序干净底图 PNG 与 `delivery.json`；幂等重交付校验已落盘 PNG 完整性。 */
export async function publish(options: {
  workDirectory: string;
  outputDirectory: string;
  expectedRevision?: number;
}): Promise<DeliveryManifest & { path: string }> {
  const directory = path.resolve(options.workDirectory);
  const parent = path.resolve(options.outputDirectory);
  return locked(directory, () =>
    locked(parent, async () => {
      const draft = load_draft(directory);
      if (!draft.confirmed)
        throw new Error("Confirm image book before publishing clean base images");
      if (options.expectedRevision !== undefined && draft.revision !== options.expectedRevision)
        throw new Error("Stale image draft revision");

      const { clean, sources } = await build_clean_manifest(directory, draft);
      const pages: DeliveryPage[] = draft.book.pages.map((page, index) => {
        const cleanPage = clean.pages[index]!;
        return {
          pageId: page.pageId,
          originalSha256: page.sha256,
          inputSha256: cleanPage.inputSha256,
          file: `${String(index + 1).padStart(4, "0")}-${page.pageId}.png`,
          sha256: cleanPage.cleanSha256,
          preserved: cleanPage.regions
            .filter((r) => r.disposition === "preserve")
            .map((r) => ({ regionId: r.regionId, reason: r.preserveReason! })),
        };
      });
      const deliverySha256 = image_sha256(
        JSON.stringify({ bookId: draft.book.bookId, status: clean.status, pages }),
      );
      const target = path.join(parent, `image-${deliverySha256.slice(0, 12)}`);
      const deliveryFile = path.join(target, "delivery.json");
      if (file_exists(deliveryFile)) {
        const existing = read_json<DeliveryManifest>(deliveryFile);
        if (existing.deliverySha256 !== deliverySha256)
          throw new Error("Published delivery mismatch");
        if (
          existing.bookId !== draft.book.bookId ||
          existing.status !== clean.status ||
          !Array.isArray(existing.pages) ||
          existing.pages.length !== pages.length
        )
          throw new Error("Published delivery manifest corrupted");
        for (const [index, expectedPage] of pages.entries()) {
          const actualPage = existing.pages[index];
          if (
            !actualPage ||
            actualPage.pageId !== expectedPage.pageId ||
            actualPage.file !== expectedPage.file ||
            actualPage.sha256 !== expectedPage.sha256
          )
            throw new Error(`Published delivery entry corrupted: ${expectedPage.pageId}`);
          const deliveredFile = path.join(target, expectedPage.file);
          if (!file_exists(deliveredFile) || (await digest(deliveredFile)) !== expectedPage.sha256)
            throw new Error(
              `Published delivery artifact missing or corrupted: ${expectedPage.file}`,
            );
        }
        return { path: target, ...existing };
      }

      const temporary = path.join(parent, `.image-${randomUUID()}`);
      await fs.make_dir_exclusive(temporary);
      try {
        for (const [index, page] of pages.entries()) {
          const cleanPage = clean.pages[index]!;
          const outPath = path.join(temporary, page.file);
          fs.copy_file(sources[cleanPage.clean]!, outPath);
          if ((await digest(outPath)) !== page.sha256)
            throw new Error(`Published clean image digest mismatch: ${page.file}`);
        }
        const manifest: DeliveryManifest = {
          bookId: draft.book.bookId,
          status: clean.status,
          deliverySha256,
          pages,
        };
        write_json(path.join(temporary, "delivery.json"), manifest);
        fs.rename(temporary, target);
        return { path: target, ...manifest };
      } catch (error) {
        await fs.remove_async(temporary, { recursive: true, force: true });
        throw error;
      }
    }),
  );
}
