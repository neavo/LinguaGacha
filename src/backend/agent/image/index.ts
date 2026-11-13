import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { default_native_fs as fs } from "../../../native/native-fs";
import lockfile from "proper-lockfile";
import { pixels, type ImageDevice } from "./engine";
import { IMAGE_MODELS } from "./models";
import { image_metadata } from "../../file/image/image-metadata";
import {
  image_sha256,
  image_records_sha256,
  validate_image_book,
  read_image_package,
} from "../../file/image/image-format";
import { workspace_requests } from "../workspace/runtime/request-channel";
import type {
  ImageBook,
  ImagePage,
  ImageRecord,
  ImageWriteback,
  ImageLayoutRequest,
  ImageLayoutResult,
  ImageTile,
} from "../../../shared/image";
export { prepare_models } from "./models";
export { INFERENCE_DEPENDENCIES } from "../inference/environment";
export type { ImageBook, ImagePage, ImageRegion, ImageRecord } from "../../../shared/image";

const STATE = "draft.json"; // 工作区内的唯一草稿状态文件名。
const ALGORITHM_VERSION = 3; // 像素修复与排版版本，变更后拒绝直接发布旧执行。
const LOCK_RETRY = { retries: 100, minTimeout: 100, maxTimeout: 1000 }; // 工作区文件锁退避策略。
type Draft = {
  revision: number;
  confirmed: boolean;
  book: ImageBook;
  records: ImageRecord[];
  sourceSha256?: string;
}; // 工作区持久化草稿状态。
type Repair = {
  base: string;
  regions: { regionId: string; ready: boolean; reason: string | null; mask: string }[];
}; // 像素修复阶段输出的底图与各区域笔画掩码。
type LayoutRegion = {
  regionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: NonNullable<ImagePage["regions"][number]["style"]>;
}; // 像素排版计算出的安全矩形与默认样式。
type RunRegion = {
  pageId: string;
  regionId: string;
  targeted: boolean;
  ready: boolean;
  reason: string | null;
}; // 单次执行记录的区域可交付状态。
type RunPage = {
  pageId: string;
  preview: string;
  regions: RunRegion[];
}; // 单次执行记录的页面预览与区域结果。
type Execution = {
  version: number;
  executionId: string;
  stateSha256: string;
  manifest: ImageWriteback;
  writebackDirectory: string;
  pages: RunPage[];
  artifacts: Record<string, string>;
}; // 单次执行快照，供复核与原子发布校验。

/** 流式计算原件与产物摘要，避免额外持有整本图片字节。 */
async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of fs.create_read_stream(file)) hash.update(bytes as Buffer);
  return hash.digest("hex");
}
/** 读取 SDK 自有记录，各业务入口继续校验其契约。 */
function read_json<T>(file: string): T {
  return JSON.parse(fs.read_text_file(file)) as T;
}
/** 记录编码归 SDK，临时文件替换和失败清理由 NativeFs 统一处理。 */
function write_json(file: string, value: unknown): void {
  fs.write_file_atomic(file, JSON.stringify(value, null, 2));
}
/** 同一工作目录串行修改，修订检查与落盘共用这次占用。 */
async function locked<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await fs.make_dir_async(directory);
  const release = await lockfile.lock(directory, { realpath: false, retries: LOCK_RETRY });
  try {
    return await action();
  } finally {
    await release();
  }
}
/** 计算草稿核心内容摘要，供发布前确认版面与原文未被修改。 */
const state_digest = (draft: Draft) =>
  image_sha256(JSON.stringify({ book: draft.book, records: draft.records }));
/** 读取草稿时核对包契约，避免手工编辑绕过保存入口。 */
async function load(directory: string): Promise<Draft> {
  const state = read_json<Draft>(path.join(directory, STATE));
  validate_image_book(state.book, state.records);
  if (!Number.isSafeInteger(state.revision) || typeof state.confirmed !== "boolean")
    throw new Error("Invalid image draft");
  return state;
}

/** 准备只产生候选，原文与编辑授权须经 apply 明确确认。 */
export async function prepare(options: {
  sources: readonly string[];
  workDirectory: string;
  device: ImageDevice;
}) {
  const directory = path.resolve(options.workDirectory);
  return locked(directory, async () => {
    try {
      fs.stat(path.join(directory, STATE));
      throw new Error("Image draft already exists");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const book: ImageBook = { version: 1, bookId: randomUUID(), pages: [] };
    const candidates: {
      pageId: string;
      result: {
        regions: ImagePage["regions"];
        preview: string;
        previewScale: number;
        candidates: { regionId: string; score: number; uncertain: boolean }[];
      };
    }[] = [];
    const records: ImageRecord[] = [];
    await fs.make_dir_async(path.join(directory, "originals"));
    for (const source of options.sources) {
      const metadata = image_metadata(fs.read_file(source));
      const pageId = randomUUID(),
        original = `originals/${pageId}${metadata.extension}`;
      const file = path.join(directory, original);
      fs.copy_file(source, file);
      const sha256 = await digest(file);
      const result = (await pixels(
        "prepare",
        { source: file, output: path.join(directory, "candidates", pageId) },
        options.device,
      )) as (typeof candidates)[number]["result"];
      book.pages.push({
        pageId,
        original,
        sha256,
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        regions: result.regions,
      });
      records.push(...result.regions.map(({ regionId }) => ({ pageId, regionId, message: "" })));
      candidates.push({ pageId, result });
    }
    const draft: Draft = { revision: 0, confirmed: false, book, records };
    validate_image_book(book, records);
    write_json(path.join(directory, STATE), draft);
    write_json(path.join(directory, "candidates.json"), candidates);
    return { ...draft, candidates };
  });
}

/** 返回当前草稿，调用方据修订提交后续更改。 */
export async function read(workDirectory: string): Promise<Draft> {
  return load(path.resolve(workDirectory));
}

/** 修订核对与写入在同一锁内。区域身份由语义决定，重排直接保留原 ID。 */
export async function apply(
  workDirectory: string,
  expectedRevision: number,
  change: { pages: ImagePage[]; records: ImageRecord[]; confirmed: boolean },
): Promise<Draft> {
  const directory = path.resolve(workDirectory);
  return locked(directory, async () => {
    const current = await load(directory);
    if (current.revision !== expectedRevision) throw new Error("Stale image draft revision");
    const next: Draft = {
      ...(current.sourceSha256 ? { sourceSha256: current.sourceSha256 } : {}),
      revision: current.revision + 1,
      confirmed: change.confirmed,
      book: { ...current.book, pages: structuredClone(change.pages) },
      records: structuredClone(change.records),
    };
    validate_image_book(next.book, next.records);
    const originals = new Map(current.book.pages.map((page) => [page.pageId, page]));
    for (const page of next.book.pages) {
      const original = originals.get(page.pageId);
      if (
        !original ||
        ["original", "sha256", "width", "height", "orientation"].some(
          (key) => Reflect.get(original, key) !== Reflect.get(page, key),
        )
      )
        throw new Error("Original identity cannot be changed by layout edits");
    }
    write_json(path.join(directory, STATE), next);
    return next;
  });
}

/** 确认后的草稿流式归档，验证完整原稿后发布包文件。 */
export async function pack(
  workDirectory: string,
  output: string,
): Promise<{ path: string; sourceSha256: string }> {
  const directory = path.resolve(workDirectory),
    target = path.resolve(output);
  return locked(directory, async () => {
    const draft = await load(directory);
    if (!draft.confirmed) throw new Error("Confirm image regions and source text before packaging");
    await fs.make_dir_async(path.dirname(target));
    const temporary = target + "." + randomUUID() + ".tmp";
    await pixels("pack", {
      root: directory,
      book: draft.book,
      records: draft.records,
      output: temporary,
    });
    await read_image_package(fs.read_file(temporary), target);
    fs.rename(temporary, target);
    const sourceSha256 = await digest(target);
    write_json(path.join(directory, STATE), { ...draft, sourceSha256 });
    return { path: target, sourceSha256 };
  });
}

/** 当前 sources 投影是恢复入口，工作缓存完全可丢弃。 */
export async function restore(sourceDirectory: string, workDirectory: string): Promise<Draft> {
  const source = path.resolve(sourceDirectory),
    directory = path.resolve(workDirectory);
  return locked(directory, async () => {
    const book = read_json<ImageBook>(path.join(source, "image.json"));
    const records = read_json<ImageRecord[]>(path.join(source, "items.json"));
    validate_image_book(book, records);
    await fs.make_dir_async(path.join(directory, "originals"));
    for (const page of book.pages) {
      const file = path.join(source, page.original);
      if ((await digest(file)) !== page.sha256) throw new Error("Original digest mismatch");
      fs.copy_file(file, path.join(directory, page.original));
    }
    const { sourceSha256 } = read_json<{ sourceSha256: string }>(
      path.join(source, "image-source.json"),
    );
    const draft: Draft = { revision: 0, confirmed: true, book, records, sourceSha256 };
    write_json(path.join(directory, STATE), draft);
    return draft;
  });
}

/** 校验并读取写回目录内的译文条目和快照清单，确保与当前草稿严格绑定。 */
function writeback(directory: string, draft: Draft) {
  const text = fs.read_file(path.join(directory, "items.json"));
  const manifest = read_json<ImageWriteback>(path.join(directory, "image-writeback.json"));
  const records = JSON.parse(text.toString("utf8")) as ImageRecord[];
  if (
    manifest.version !== 1 ||
    !manifest.generationId ||
    manifest.sourceSha256 !== draft.sourceSha256 ||
    manifest.recordsSha256 !== image_records_sha256(draft.book, draft.records) ||
    manifest.itemsSha256 !== image_sha256(text)
  )
    throw new Error("Image generation snapshot does not match source or text");
  if (records.length !== draft.records.length || manifest.rows.length !== records.length)
    throw new Error("Incomplete image writeback");
  for (const [row, record] of records.entries()) {
    const source = draft.records[row]!,
      status = manifest.rows[row]!;
    if (
      typeof record.message !== "string" ||
      record.pageId !== source.pageId ||
      record.regionId !== source.regionId ||
      status.row !== row ||
      status.pageId !== source.pageId ||
      status.regionId !== source.regionId ||
      typeof status.completed !== "boolean"
    )
      throw new Error("Image writeback row mismatch");
  }
  return { records, manifest };
}

/** 修复缓存独立于译文；执行结果固定本次文本、原稿和图层摘要。 */
export async function execute(options: {
  workDirectory: string;
  writebackDirectory: string;
  device: ImageDevice;
}) {
  const directory = path.resolve(options.workDirectory);
  return locked(directory, async () => {
    const draft = await load(directory);
    if (!draft.confirmed) throw new Error("Unconfirmed image draft");
    const snapshot = writeback(path.resolve(options.writebackDirectory), draft);
    const executionId = randomUUID(),
      runDirectory = path.join(directory, "runs", executionId);
    await fs.make_dir_async(runDirectory);
    const execution: Execution = {
      version: ALGORITHM_VERSION,
      executionId,
      stateSha256: state_digest(draft),
      manifest: snapshot.manifest,
      writebackDirectory: path.resolve(options.writebackDirectory),
      pages: [],
      artifacts: {},
    };
    for (const page of draft.book.pages) {
      const source = path.join(directory, page.original);
      if ((await digest(source)) !== page.sha256) throw new Error("Original changed");
      const repairKey = image_sha256(
        JSON.stringify({
          version: ALGORITHM_VERSION,
          source: [page.sha256, page.width, page.height, page.orientation],
          regions: page.regions.map(({ regionId, bbox, disposition }) => ({
            regionId,
            bbox,
            disposition,
          })),
          model: IMAGE_MODELS.inpaint.sha256,
          device: options.device,
        }),
      );
      const repairDirectory = path.join(directory, "cache", repairKey),
        report = path.join(repairDirectory, "success.json");
      let repair: Repair | undefined;
      try {
        const cached = read_json<{ result: Repair; artifacts: Record<string, string> }>(report);
        let valid = true;
        for (const [file, hash] of Object.entries(cached.artifacts))
          if ((await digest(file)) !== hash) {
            valid = false;
            break;
          }
        if (valid) repair = cached.result;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      if (!repair) {
        const output = path.join(repairDirectory, randomUUID());
        repair = (await pixels("repair", { source, page, output }, options.device)) as Repair;
        const artifacts: Record<string, string> = {};
        for (const file of [repair.base, ...repair.regions.map((region) => region.mask)])
          artifacts[file] = await digest(file);
        await fs.make_dir_async(repairDirectory);
        write_json(report, { result: repair, artifacts });
      }
      const layoutRegions = (await pixels("layout", { source, page })) as LayoutRegion[];
      const pageRecords = new Map(
        snapshot.records.map((record, row) => [
          record.pageId + "/" + record.regionId,
          { record, completed: snapshot.manifest.rows[row]!.completed },
        ]),
      );
      const request: ImageLayoutRequest = {
        kind: "render_image",
        regions: layoutRegions
          .filter((region) => pageRecords.get(page.pageId + "/" + region.regionId)?.completed)
          .map((region) => {
            const intent = page.regions.find((item) => item.regionId === region.regionId)!;
            return {
              regionId: region.regionId,
              width: region.width,
              height: region.height,
              direction: intent.direction,
              style: region.style,
              text: pageRecords.get(page.pageId + "/" + region.regionId)!.record.message,
            };
          }),
      };
      const layout = request.regions.length
        ? ((await workspace_requests().call(request)) as ImageLayoutResult)
        : { regions: [] };
      const compositeRegions = page.regions.map((region) => {
        const prepared = repair.regions.find((item) => item.regionId === region.regionId)!;
        const record = pageRecords.get(page.pageId + "/" + region.regionId);
        const rendered = layout.regions.find((item) => item.regionId === region.regionId);
        const position = layoutRegions.find((item) => item.regionId === region.regionId);
        const ready = prepared.ready && !!record?.completed && !!rendered?.ready;
        return {
          pageId: page.pageId,
          regionId: region.regionId,
          targeted: !!record,
          ready,
          reason: !prepared.ready
            ? prepared.reason
            : !record?.completed
              ? "incomplete_text"
              : !rendered?.ready
                ? (rendered?.reason ?? "needs_layout")
                : null,
          mask: prepared.mask,
          tiles: ready
            ? rendered!.tiles.map((tile) => ({
                ...tile,
                x: tile.x + position!.x,
                y: tile.y + position!.y,
              }))
            : ([] as ImageTile[]),
        };
      });
      const preview = path.join(runDirectory, "page-" + page.pageId + ".png");
      const composite = (await pixels("composite", {
        source,
        base: repair.base,
        output: preview,
        regions: compositeRegions.map((region) => ({ ...region, accepted: region.ready })),
      })) as { rejectedRegions: string[] };
      const rejected = new Set(composite.rejectedRegions);
      const regions: RunRegion[] = compositeRegions.map((region) => ({
        pageId: region.pageId,
        regionId: region.regionId,
        targeted: region.targeted,
        ready: region.ready && !rejected.has(region.regionId),
        reason: rejected.has(region.regionId) ? "text_collision" : region.reason,
      }));
      execution.pages.push({ pageId: page.pageId, preview, regions });
      for (const file of [source, preview]) execution.artifacts[file] = await digest(file);
    }
    write_json(path.join(runDirectory, "execution.json"), execution);
    return {
      executionId,
      generationId: snapshot.manifest.generationId,
      status: "draft" as const,
      pages: execution.pages.map((page) => ({
        pageId: page.pageId,
        preview: page.preview,
        regions: page.regions.map(({ regionId, ready, reason }) => ({ regionId, ready, reason })),
      })),
    };
  });
}

/** 发布新目录是唯一提交点，同执行身份重试读取已发布事实。 */
export async function publish(options: {
  workDirectory: string;
  executionId: string;
  outputDirectory: string;
}) {
  const directory = path.resolve(options.workDirectory),
    parent = path.resolve(options.outputDirectory);
  if (!/^[a-f0-9-]{36}$/u.test(options.executionId)) throw new Error("Invalid execution identity");
  return locked(directory, () =>
    locked(parent, async () => {
      const execution = read_json<Execution>(
        path.join(directory, "runs", options.executionId, "execution.json"),
      );
      const target = path.join(parent, "image-" + execution.executionId);
      try {
        const published = read_json<{ executionId: string; inputSha256: string }>(
          path.join(target, "delivery.json"),
        );
        if (
          published.executionId !== execution.executionId ||
          published.inputSha256 !== image_sha256(JSON.stringify(execution))
        )
          throw new Error("Published execution mismatch");
        return { path: target, ...published };
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      if (execution.version !== ALGORITHM_VERSION)
        throw new Error("Image algorithms changed; execute and review again");
      const draft = await load(directory);
      if (state_digest(draft) !== execution.stateSha256)
        throw new Error("Image structure changed after review");
      const current = writeback(execution.writebackDirectory, draft);
      if (JSON.stringify(current.manifest) !== JSON.stringify(execution.manifest))
        throw new Error("Generation changed after review");
      for (const [file, sha256] of Object.entries(execution.artifacts))
        if ((await digest(file)) !== sha256) throw new Error("Reviewed image artifact changed");
      const temporary = path.join(parent, ".image-" + randomUUID());
      await fs.make_dir_exclusive(temporary);
      const pages = [];
      for (const [index, page] of execution.pages.entries()) {
        const name = `${String(index + 1).padStart(4, "0")}-${page.pageId}.png`;
        const output = path.join(temporary, name);
        fs.copy_file(page.preview, output);
        pages.push({
          pageId: page.pageId,
          file: name,
          sha256: await digest(output),
        });
      }
      const regions = execution.pages.flatMap((page) => page.regions);
      const manifest = {
        executionId: execution.executionId,
        inputSha256: image_sha256(JSON.stringify(execution)),
        generation: execution.manifest,
        status: regions.every((region) => region.ready || !region.targeted)
          ? "complete"
          : "partial",
        pages,
        regions: regions.map(({ pageId, regionId, ready, reason }) => ({
          pageId,
          regionId,
          accepted: ready,
          reason,
        })),
      };
      write_json(path.join(temporary, "delivery.json"), manifest);
      fs.rename(temporary, target);
      return { path: target, ...manifest };
    }),
  );
}
