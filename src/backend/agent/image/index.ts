import { build_clean_manifest } from "./artifacts";
export {
  publish,
  type DeliveryManifest,
  type DeliveryPage,
  type ImageDeliverySource,
  type ImageTextDecision,
} from "./publish";
export { render } from "./render";
export type {
  ImageTextInput,
  ImageTextRender,
  ImageTextPageResult,
  ImageTextRegionResult,
} from "../../../shared/image-text";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import type {
  ImageBook,
  ImageClean,
  ImagePage,
  ImageRecord,
  ImageRegion,
} from "../../../shared/image";
import {
  compute_clean_status,
  erase_input_digest,
  image_sha256,
  validate_image_book,
  validate_image_clean,
  validate_image_layout_areas,
  validate_image_page_pixels,
} from "../../file/image/image-format";
import { image_metadata } from "../../file/image/image-metadata";
import {
  read_candidate_decisions,
  validate_candidate_run,
  type CandidateDecision,
} from "./candidate";
export type { CandidateDecision } from "./candidate";
import { pixels, type ImageDevice } from "./engine";
import {
  commit_directory,
  EVIDENCE_INDEX_FILE,
  STATE_FILE,
  assert_immutable_pages,
  ensure_normalized,
  file_exists,
  load_draft,
  locked,
  normalized_meta_path,
  normalized_path,
  read_json,
  stage_reviewed_page,
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
  ImageRecord,
  ImageRegion,
} from "../../../shared/image";
export type {
  Draft,
  ErasePageResult,
  PrepareCandidate,
  PreparePageEvidence,
  ReviewRecord,
  ReviewedPageRef,
  RunRecord,
} from "./state";

const UUID_RE = /^[a-f0-9-]{36}$/u; // runId 直接参与目录定位，拒绝路径片段。

/** 状态读取只比较当前消字输入。产物完整性由消费入口验证。 */
function collect_review_status(draft: Draft) {
  return draft.book.pages.map((page) => {
    const inputSha256 = erase_input_digest(page);
    return {
      pageId: page.pageId,
      inputSha256,
      reviewed: draft.reviewed?.[page.pageId]?.inputSha256 === inputSha256,
    };
  });
}

/** 第一阶段取证：保留原始字节与身份，气泡分割冻结选区，排除文字框后产出底色与分流建议。 */
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

    const stage = path.join(directory, `.prepare-${randomUUID()}`);
    await fs.make_dir_async(stage);
    try {
      const book: ImageBook = { bookId: randomUUID(), pages: [] };
      const records: ImageRecord[] = [];
      const pageMeta: {
        pageId: string;
        original: string;
        sha256: string;
        width: number;
        height: number;
        orientation: number;
      }[] = [];

      await fs.make_dir_async(path.join(stage, "originals"));
      for (const source of options.sources) {
        const originalBytes = fs.read_file(source);
        const metadata = image_metadata(originalBytes);
        const pageId = randomUUID();
        const original = `originals/${pageId}${metadata.extension}`;
        const target = path.join(stage, original);
        fs.write_file_atomic(target, originalBytes);
        pageMeta.push({
          pageId,
          original,
          sha256: image_sha256(originalBytes),
          width: metadata.width,
          height: metadata.height,
          orientation: metadata.orientation,
        });
      }

      // 规范化原图先统一落地（复用 MuPDF 规范化编码），确保 EXIF 方向在像素阶段始终一致。
      const stubPages: ImagePage[] = pageMeta.map((p) => ({
        ...p,
        textBoxes: [],
        falsePositiveTextBoxIds: [],
        regions: [],
      }));
      const normalized = await ensure_normalized(stage, stubPages);

      const evidence: PreparePageEvidence[] = [];
      for (const meta of pageMeta) {
        const result = (await pixels(
          "prepare",
          {
            source: normalized.get(meta.pageId)!,
            output: path.join(stage, "evidence", meta.pageId),
            layoutAreaRoot: stage,
            pageId: meta.pageId,
          },
          device,
        )) as {
          width: number;
          height: number;
          preview: string;
          previewScale: number;
          fillPreview: string;
          crops: Record<string, string>;
          candidates: PrepareCandidate[];
          draftRegions: ImageRegion[];
          textBoxes: PreparePageEvidence["textBoxes"];
          backgrounds: PreparePageEvidence["backgrounds"];
        };
        book.pages.push({
          ...meta,
          textBoxes: result.textBoxes.map(({ ownerRegionId: _owner, ...textBox }) => textBox),
          falsePositiveTextBoxIds: [],
          regions: result.draftRegions,
        });
        records.push(
          ...result.draftRegions
            .filter((r) => r.disposition === "translate")
            .map(({ regionId }) => ({ pageId: meta.pageId, regionId, message: "" })),
        );
        evidence.push({
          pageId: meta.pageId,
          width: result.width,
          height: result.height,
          preview: result.preview.replace(stage, directory),
          previewScale: result.previewScale,
          fillPreview: result.fillPreview.replace(stage, directory),
          textBoxes: result.textBoxes,
          backgrounds: result.backgrounds,
          crops: Object.fromEntries(
            Object.entries(result.crops).map(([id, file]) => [id, file.replace(stage, directory)]),
          ),
          candidates: result.candidates.map((candidate) => ({
            ...candidate,
            rawMask: candidate.rawMask.replace(stage, directory),
          })),
        });
      }

      const draft: Draft = { revision: 0, confirmed: false, book, records, reviewed: {} };
      validate_image_book(book, records, { confirmed: false });
      for (const page of book.pages)
        await validate_image_layout_areas(page, async (member) =>
          fs.read_file(path.join(stage, member)),
        );
      write_json(path.join(stage, EVIDENCE_INDEX_FILE), evidence);
      for (const name of ["originals", "normalized", "layout-areas", "evidence"]) {
        const source = path.join(stage, name);
        if (file_exists(source)) fs.copy_entry(source, path.join(directory, name));
      }
      write_json(path.join(directory, STATE_FILE), draft);
      return { ...draft, evidence };
    } finally {
      await fs.remove_async(stage, { recursive: true, force: true });
    }
  });
}

/** 读取当前草稿、检测证据以及各页已验收状态（`inputSha256` 是否匹配）。 */
export async function read(workDirectory: string) {
  const directory = path.resolve(workDirectory);
  return locked(directory, async () => {
    const draft = load_draft(directory);
    const evidenceFile = path.join(directory, EVIDENCE_INDEX_FILE);
    const evidence = file_exists(evidenceFile)
      ? read_json<PreparePageEvidence[]>(evidenceFile)
      : [];
    const reviewStatus = collect_review_status(draft);
    return { ...draft, reviewStatus, evidence };
  });
}

/** `apply` 根据文字框分组生成无框排版区域，调用者不写掩码路径。 */
async function prepare_layout_areas(
  directory: string,
  current: Draft,
  pages: ImagePage[],
  stage: string,
): Promise<{
  evidence: PreparePageEvidence[];
  replacements: { source: string; target: string }[];
}> {
  const evidence = structuredClone(
    read_json<PreparePageEvidence[]>(path.join(directory, EVIDENCE_INDEX_FILE)),
  );
  const replacements: { source: string; target: string }[] = [];
  for (const page of pages) {
    const previous = current.book.pages.find((item) => item.pageId === page.pageId)!;
    const pageEvidence = evidence.find((item) => item.pageId === page.pageId)!;
    for (const region of page.regions.filter((item) => item.kind === "bubble")) {
      const existing = previous.regions.find((item) => item.regionId === region.regionId);
      if (
        !existing ||
        existing.kind !== "bubble" ||
        region.layoutArea?.path !== existing.layoutArea?.path ||
        region.layoutArea?.sha256 !== existing.layoutArea?.sha256
      )
        throw new Error(`Bubble layout area is not registered: ${page.pageId}/${region.regionId}`);
    }
    const unframed = page.regions.filter(
      (region) => region.kind === "unframed" && region.textBoxIds.length > 0,
    );
    page.regions = page.regions.map((region) =>
      region.kind === "unframed" && region.textBoxIds.length === 0
        ? { ...region, layoutArea: null }
        : region,
    );
    if (unframed.length) {
      const normalized = (await ensure_normalized(directory, [page])).get(page.pageId)!;
      const result = (await pixels("layout_areas", {
        source: normalized,
        root: directory,
        output: stage,
        page: { ...page, regions: page.regions.filter((region) => region.kind === "bubble") },
        textBoxes: pageEvidence.textBoxes,
        groups: unframed.map((region) => ({
          regionId: region.regionId,
          textBoxIds: region.textBoxIds,
        })),
      })) as { regions: ImageRegion[]; backgrounds: PreparePageEvidence["backgrounds"] };
      const generated = new Map(result.regions.map((region) => [region.regionId, region]));
      page.regions = page.regions.map((region) => {
        if (region.kind === "bubble") return region;
        if (region.textBoxIds.length === 0) return { ...region, layoutArea: null };
        const area = generated.get(region.regionId);
        if (!area)
          throw new Error(`Missing unframed layout area: ${page.pageId}/${region.regionId}`);
        return {
          ...region,
          layoutArea: area.layoutArea,
          ...(region.disposition === "translate" && region.backgroundColor === null
            ? { backgroundColor: area.backgroundColor }
            : {}),
        };
      });
      for (const region of result.regions) {
        const source = path.join(stage, region.layoutArea!.path);
        replacements.push({ source, target: path.join(directory, region.layoutArea!.path) });
      }
      pageEvidence.backgrounds = {
        ...Object.fromEntries(
          Object.entries(pageEvidence.backgrounds).filter(([regionId]) =>
            page.regions.some((region) => region.regionId === regionId && region.kind === "bubble"),
          ),
        ),
        ...result.backgrounds,
      };
    }
    const owners = new Map(
      page.regions.flatMap((region) =>
        region.textBoxIds.map((textBoxId) => [textBoxId, region.regionId] as const),
      ),
    );
    pageEvidence.textBoxes = pageEvidence.textBoxes.map((textBox) => ({
      ...textBox,
      ownerRegionId: owners.get(textBox.textBoxId) ?? null,
    }));
    const regionIds = new Set(page.regions.map((region) => region.regionId));
    pageEvidence.backgrounds = Object.fromEntries(
      Object.entries(pageEvidence.backgrounds).filter(([regionId]) => regionIds.has(regionId)),
    );
  }
  return { evidence, replacements };
}

/** 在工作区锁下原子提交确认的区域、填色配置与按阅读顺序排列的原文字段。 */
export async function apply(
  workDirectory: string,
  expectedRevision: number,
  change: { pages: ImagePage[]; records: ImageRecord[]; confirmed: boolean },
): Promise<Draft> {
  const directory = path.resolve(workDirectory);
  return locked(directory, async () => {
    const current = load_draft(directory);
    if (current.revision !== expectedRevision)
      throw new Error("Stale image draft revision; call read() and reconsider the operation");
    assert_immutable_pages(current.book.pages, change.pages);

    const nextPages = structuredClone(change.pages);
    const nextRecords = structuredClone(change.records);
    validate_image_book({ ...current.book, pages: nextPages }, nextRecords, { confirmed: false });
    const stage = path.join(directory, `.apply-${randomUUID()}`);
    await fs.make_dir_exclusive(stage);
    try {
      const { evidence, replacements } = await prepare_layout_areas(
        directory,
        current,
        nextPages,
        stage,
      );
      validate_image_book({ ...current.book, pages: nextPages }, nextRecords, {
        confirmed: change.confirmed,
      });
      for (const page of nextPages)
        await validate_image_layout_areas(page, async (member) => {
          const replacement = replacements.find(
            (item) => item.target === path.join(directory, member),
          );
          return fs.read_file(replacement?.source ?? path.join(directory, member));
        });
      const reviewed: Record<string, ReviewedPageRef> = {};
      for (const page of nextPages) {
        const existing = current.reviewed?.[page.pageId];
        if (existing && existing.inputSha256 === erase_input_digest(page))
          reviewed[page.pageId] = existing;
      }
      const next: Draft = {
        revision: current.revision + 1,
        confirmed: change.confirmed,
        book: { ...current.book, pages: nextPages },
        records: nextRecords,
        reviewed,
      };
      const evidenceFile = path.join(directory, EVIDENCE_INDEX_FILE);
      const previousEvidence = fs.read_file(evidenceFile);
      const backups = replacements.map((replacement, index) => {
        if (!file_exists(replacement.target)) return { target: replacement.target };
        const backup = path.join(stage, "backups", String(index));
        fs.copy_file(replacement.target, backup);
        return { target: replacement.target, backup };
      });
      try {
        for (const replacement of replacements)
          fs.copy_file_atomic(replacement.source, replacement.target);
        write_json(evidenceFile, evidence);
        write_json(path.join(directory, STATE_FILE), next);
      } catch (cause) {
        const rollbackErrors: unknown[] = [];
        for (const backup of backups)
          try {
            if (backup.backup) fs.copy_file_atomic(backup.backup, backup.target);
            else await fs.remove_async(backup.target, { force: true });
          } catch (error) {
            rollbackErrors.push(error);
          }
        try {
          fs.write_file_atomic(evidenceFile, previousEvidence);
        } catch (error) {
          rollbackErrors.push(error);
        }
        if (rollbackErrors.length)
          throw new AggregateError([cause, ...rollbackErrors], "Image apply rollback failed", {
            cause,
          });
        throw cause;
      }
      return next;
    } finally {
      await fs.remove_async(stage, { recursive: true, force: true });
    }
  });
}

/** 生成逐区域候选和按页拼图。候选运行不修改已提交底图。 */
export async function erase(options: {
  workDirectory: string;
  expectedRevision: number;
  pageIds?: readonly string[];
}) {
  const directory = path.resolve(options.workDirectory);

  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (draft.revision !== options.expectedRevision)
      throw new Error("Stale image draft revision; call read() and reconsider the operation");
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

    const evidence = read_json<PreparePageEvidence[]>(path.join(directory, EVIDENCE_INDEX_FILE));
    const normalized = await ensure_normalized(directory, targetPages);
    const runId = randomUUID();
    const runDir = path.join(directory, "runs", runId);
    const stage = path.join(directory, "runs", `.erase-${runId}`);
    const results: ErasePageResult[] = [];
    await fs.make_dir_async(path.dirname(stage));
    await fs.make_dir_exclusive(stage);
    try {
      for (const page of targetPages) {
        const pageStage = path.join(stage, page.pageId);
        const pageEvidence = evidence.find((item) => item.pageId === page.pageId);
        if (!pageEvidence) throw new Error(`Missing page evidence: ${page.pageId}`);
        const raw = (await pixels("erase", {
          source: normalized.get(page.pageId)!,
          page,
          root: directory,
          output: pageStage,
          fillRegionIds: Object.entries(pageEvidence.backgrounds)
            .filter(([, background]) => background.route === "fill")
            .map(([regionId]) => regionId),
        })) as {
          regions: ErasePageResult["regions"];
          materials: string[];
        };
        const relative = (file: string) => {
          const member = path.relative(stage, file);
          if (!member || member.startsWith("..") || path.isAbsolute(member))
            throw new Error("Invalid erase run member");
          return member.split(path.sep).join("/");
        };
        const regions = raw.regions.map((region) => ({
          ...region,
          candidates: region.candidates.map((candidate) => ({
            ...candidate,
            crop: relative(candidate.crop),
            eraseMask: relative(candidate.eraseMask),
          })),
        }));
        const materials = raw.materials.map(relative);
        results.push({
          pageId: page.pageId,
          inputSha256: erase_input_digest(page),
          materials,
          regions,
        });
      }
      const record: RunRecord = { runId, pages: results };
      write_json(path.join(stage, "run.json"), record);
      await commit_directory(stage, runDir);
      const nextRevision = draft.revision + 1;
      try {
        write_json(path.join(directory, STATE_FILE), { ...draft, revision: nextRevision });
      } catch (error) {
        await fs.remove_async(runDir, { recursive: true, force: true }); // 草稿提交失败，本次运行尚未交付。
        throw error;
      }
      return {
        runId,
        revision: nextRevision,
        pages: results.map((page) => ({
          ...page,
          materials: page.materials.map((member) => path.join(runDir, member)),
        })),
      };
    } finally {
      await fs.remove_async(stage, { recursive: true, force: true });
    }
  });
}

/** 校验按页选择，组合已选像素并一次提交最终区域状态与验收底图。 */
export async function review(options: {
  workDirectory: string;
  runId: string;
  expectedRevision: number;
  pages: readonly CandidateDecision[];
}) {
  if (!UUID_RE.test(options.runId)) throw new Error("Invalid runId");
  const directory = path.resolve(options.workDirectory);

  return locked(directory, async () => {
    const draft = load_draft(directory);
    const runFile = path.join(directory, "runs", options.runId, "run.json");
    const run = read_json<RunRecord>(runFile);
    validate_candidate_run(path.dirname(runFile), options.runId, run);
    const decisions = read_candidate_decisions(run.pages, options.pages);
    const reviewDecision = JSON.stringify(decisions);
    const replayed = run.pages.every(
      (page) =>
        draft.reviewed?.[page.pageId]?.runId === options.runId &&
        draft.reviewed?.[page.pageId]?.reviewDecision === reviewDecision,
    );
    if (replayed) return { runId: options.runId, revision: draft.revision, replayed: true };
    if (!draft.confirmed) throw new Error("Image draft must remain confirmed for review");
    if (draft.revision !== options.expectedRevision)
      throw new Error("Stale image draft revision; call read() and reconsider the operation");

    const nextPages = structuredClone(draft.book.pages);
    const staged: {
      pageId: string;
      inputSha256: string;
      cleanSource: string;
      cleanSha256: string;
      regions: Parameters<typeof stage_reviewed_page>[2]["regions"];
    }[] = [];
    const composeStage = path.join(directory, "runs", options.runId, `.compose-${randomUUID()}`);
    await fs.make_dir_exclusive(composeStage);
    try {
      const normalized = await ensure_normalized(
        directory,
        nextPages.filter((page) => run.pages.some((runPage) => runPage.pageId === page.pageId)),
      );
      for (const runPage of run.pages) {
        const page = nextPages.find((item) => item.pageId === runPage.pageId)!;
        if (erase_input_digest(page) !== runPage.inputSha256)
          throw new Error(`Stale erase run for page ${page.pageId}; run erase again`);
        const pageDecision = decisions.find((item) => item.pageId === page.pageId)!;
        const choices = new Map(pageDecision.regions.map((item) => [item.regionId, item.value]));
        const runRegions = new Map(runPage.regions.map((item) => [item.regionId, item]));
        const translatedIds = new Set(
          page.regions
            .filter((region) => region.disposition === "translate")
            .map((region) => region.regionId),
        );
        if (
          translatedIds.size !== runRegions.size ||
          runPage.regions.some((region) => !translatedIds.has(region.regionId))
        )
          throw new Error(`Run region mismatch on page ${page.pageId}`);
        page.regions = page.regions.map((region) => {
          if (region.disposition === "preserve") return region;
          const choice = choices.get(region.regionId)!;
          if (choice !== "preserve" && choice !== "failed") return region;
          return {
            ...region,
            disposition: "preserve" as const,
            preserveReason:
              choice === "preserve" ? ("intentional" as const) : ("repair_failed" as const),
            direction: null,
            backgroundColor: null,
          };
        });
        const selected = page.regions.map((region) => {
          if (region.disposition === "preserve")
            return {
              regionId: region.regionId,
              disposition: "preserve" as const,
              preserveReason: region.preserveReason!,
            };
          const choice = choices.get(region.regionId)!;
          const candidate = runRegions
            .get(region.regionId)!
            .candidates.find((item) => item.candidateId === choice)!;
          return { regionId: region.regionId, disposition: "translate" as const, candidate };
        });
        const composed = (await pixels("compose_candidates", {
          source: normalized.get(page.pageId)!,
          workspaceRoot: directory,
          root: path.join(directory, "runs", options.runId),
          output: path.join(composeStage, page.pageId),
          page,
          selected,
        })) as {
          clean: string;
          cleanSha256: string;
          regions: {
            regionId: string;
            disposition: "translate" | "preserve";
            preserveReason?: "intentional" | "repair_failed" | "unreadable";
            eraseMask?: string;
            eraseMaskSha256?: string;
          }[];
        };
        await validate_image_page_pixels(page, composed, async (member) =>
          fs.read_file(path.isAbsolute(member) ? member : path.join(directory, member)),
        );
        staged.push({
          pageId: page.pageId,
          inputSha256: erase_input_digest(page),
          cleanSource: composed.clean,
          cleanSha256: composed.cleanSha256,
          regions: composed.regions.map((region) => {
            if (region.disposition === "preserve")
              return {
                regionId: region.regionId,
                disposition: "preserve" as const,
                ...(region.preserveReason ? { preserveReason: region.preserveReason } : {}),
              };
            if (!region.eraseMask || !region.eraseMaskSha256)
              throw new Error(`Missing composed erase mask: ${page.pageId}/${region.regionId}`);
            return {
              regionId: region.regionId,
              disposition: "translate" as const,
              eraseMaskSource: region.eraseMask,
              eraseMaskSha256: region.eraseMaskSha256,
            };
          }),
        });
      }
      validate_image_book({ ...draft.book, pages: nextPages }, draft.records, { confirmed: true });
      const nextReviewed: Record<string, ReviewedPageRef> = { ...draft.reviewed };
      const reviewId = randomUUID();
      for (const page of staged) {
        await stage_reviewed_page(directory, reviewId, page);
        nextReviewed[page.pageId] = {
          inputSha256: page.inputSha256,
          reviewId,
          runId: options.runId,
          reviewDecision,
        };
      }
      const next: Draft = {
        ...draft,
        revision: draft.revision + 1,
        book: { ...draft.book, pages: nextPages },
        reviewed: nextReviewed,
      };
      write_json(path.join(directory, STATE_FILE), next);
      return {
        runId: options.runId,
        revision: next.revision,
        replayed: false,
        status: compute_clean_status(next.book),
      };
    } finally {
      await fs.remove_async(composeStage, { recursive: true, force: true });
    }
  });
}

/** 打包 `.image` 资产：要求整书确认且逐页通过验收，离线无模型即可完成。 */
export async function pack(
  workDirectory: string,
  output: string,
): Promise<{ path: string; status: ImageClean["status"] }> {
  const directory = path.resolve(workDirectory);
  const target = path.resolve(output);
  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (!draft.confirmed) throw new Error("Confirm image regions and source text before packaging");
    const { clean, sources } = await build_clean_manifest(directory, draft);

    await fs.make_dir_async(path.dirname(target));
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await pixels("pack", {
        root: directory,
        sources,
        book: draft.book,
        records: draft.records,
        clean,
        output: temporary,
      });
      fs.rename(temporary, target);
    } finally {
      await fs.remove_async(temporary, { force: true });
    }
    return { path: target, status: clean.status };
  });
}

/** 从工程展开的 `sources/<asset>/` 离线恢复工作区，失效旧规范化缓存并恢复验收产物。 */
export async function restore(sourceDirectory: string, workDirectory: string): Promise<Draft> {
  const source = path.resolve(sourceDirectory);
  const directory = path.resolve(workDirectory);
  return locked(directory, async () => {
    const book = read_json<ImageBook>(path.join(source, "image.json"));
    const records = read_json<ImageRecord[]>(path.join(source, "items.json"));
    const clean = read_json<ImageClean>(path.join(source, "clean.json"));
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
        regions: Parameters<typeof stage_reviewed_page>[2]["regions"];
      }[] = [];

      for (const page of book.pages) {
        const srcOrig = path.join(source, page.original);
        for (const region of page.regions) {
          if (region.layoutArea)
            fs.copy_file(
              path.join(source, region.layoutArea.path),
              path.join(stageRoot, region.layoutArea.path),
            );
        }
        const stagedOrig = path.join(stageRoot, page.original);
        fs.copy_file(srcOrig, stagedOrig);

        const cleanPage = cleanById.get(page.pageId)!;
        const inputSha256 = cleanPage.inputSha256;
        const srcClean = path.join(source, cleanPage.clean);
        fs.copy_file(srcClean, path.join(stageRoot, cleanPage.clean));
        for (const region of cleanPage.regions)
          if (region.eraseMask?.startsWith("erase-masks/"))
            fs.copy_file(
              path.join(source, region.eraseMask),
              path.join(stageRoot, region.eraseMask),
            );
        await validate_image_page_pixels(page, cleanPage, async (member) =>
          fs.read_file(path.join(stageRoot, member)),
        );

        const stagedRegions: Parameters<typeof stage_reviewed_page>[2]["regions"][number][] = [];
        for (const cr of cleanPage.regions) {
          if (cr.disposition === "preserve") {
            stagedRegions.push({
              regionId: cr.regionId,
              disposition: "preserve",
              ...(cr.preserveReason ? { preserveReason: cr.preserveReason } : {}),
            });
            continue;
          }
          if (!cr.eraseMask || !cr.eraseMaskSha256)
            throw new Error(`Clean region missing erase mask: ${page.pageId}/${cr.regionId}`);
          stagedRegions.push({
            regionId: cr.regionId,
            disposition: "translate",
            eraseMaskSource: path.join(stageRoot, cr.eraseMask),
            eraseMaskSha256: cr.eraseMaskSha256,
          });
        }

        stageItems.push({
          page,
          stagedOrig,
          inputSha256,
          cleanSource: path.join(stageRoot, cleanPage.clean),
          cleanSha256: cleanPage.cleanSha256,
          regions: stagedRegions,
        });
      }

      // 第二阶段：全部校验通过后再固化 reviewed 产物，并提交工作区原稿、规范化缓存失效与草稿状态。
      const reviewed: Record<string, ReviewedPageRef> = {};
      const reviewId = randomUUID();
      for (const item of stageItems) {
        await stage_reviewed_page(directory, reviewId, {
          pageId: item.page.pageId,
          inputSha256: item.inputSha256,
          cleanSource: item.cleanSource,
          cleanSha256: item.cleanSha256,
          regions: item.regions,
        });
        reviewed[item.page.pageId] = {
          inputSha256: item.inputSha256,
          reviewId,
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
        for (const region of item.page.regions)
          if (region.layoutArea) backupTarget(path.join(directory, region.layoutArea.path));
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

      const draft: Draft = { revision: 0, confirmed: true, book, records, reviewed };
      try {
        for (const item of stageItems) {
          fs.copy_file_atomic(item.stagedOrig, path.join(directory, item.page.original));
          for (const region of item.page.regions)
            if (region.layoutArea)
              fs.copy_file_atomic(
                path.join(stageRoot, region.layoutArea.path),
                path.join(directory, region.layoutArea.path),
              );
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
