import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { default_native_fs as fs } from "../../../native/native-fs";
import lockfile from "proper-lockfile";
import { pixels, type ImageDevice } from "./engine";
import { IMAGE_MODELS } from "./models";
import { image_metadata } from "../../file/image/image-metadata";
import {
  image_sha256,
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
export type {
  ImageBook,
  ImagePage,
  ImageRegion,
  ImageGroup,
  ImageRecord,
} from "../../../shared/image";

const STATE = "draft.json";
const ALGORITHM_VERSION = 2;
const LOCK_RETRY = { retries: 100, minTimeout: 100, maxTimeout: 1000 };
type Draft = {
  revision: number;
  confirmed: boolean;
  book: ImageBook;
  records: ImageRecord[];
  sourceSha256?: string;
};
type Measurement = ImageLayoutRequest["regions"][number]["measurement"];
type Repair = {
  base: string;
  groups: { groupId: string; ready: boolean; reason: string | null; mask: string }[];
};
type LayoutRegion = {
  regionId: string;
  groupId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mask: string;
  measurement: Measurement;
};
type RunGroup = {
  pageId: string;
  groupId: string;
  targeted: boolean;
  ready: boolean;
  reason: string | null;
  mask: string;
  tiles: ImageTile[];
};
type RunPage = {
  pageId: string;
  source: string;
  base: string;
  preview: string;
  groups: RunGroup[];
};
type Execution = {
  version: number;
  executionId: string;
  stateSha256: string;
  manifest: ImageWriteback;
  writebackDirectory: string;
  pages: RunPage[];
  artifacts: Record<string, string>;
};
export type ImageReview = { pageId: string; groupId: string; decision: "accept" | "preserve" };

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
    const candidates: unknown[] = [];
    await fs.make_dir_async(path.join(directory, "originals"));
    for (const source of options.sources) {
      const metadata = image_metadata(fs.read_file(source));
      const pageId = randomUUID(),
        original = `originals/${pageId}${metadata.extension}`;
      const file = path.join(directory, original);
      fs.copy_file(source, file);
      const sha256 = await digest(file);
      const result = await pixels(
        "prepare",
        { source: file, output: path.join(directory, "candidates", pageId) },
        options.device,
      );
      book.pages.push({
        pageId,
        original,
        sha256,
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        regions: [],
        groups: [],
      });
      candidates.push({ pageId, result });
    }
    const draft: Draft = { revision: 0, confirmed: false, book, records: [] };
    validate_image_book(book, []);
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
    for (const page of book.pages)
      for (const group of page.groups)
        if (group.mask) {
          const file = path.join(source, group.mask.path);
          if ((await digest(file)) !== group.mask.sha256) throw new Error("Mask digest mismatch");
          await fs.make_dir_async(path.dirname(path.join(directory, group.mask.path)));
          fs.copy_file(file, path.join(directory, group.mask.path));
        }
    const { sourceSha256 } = read_json<{ sourceSha256: string }>(
      path.join(source, "image-source.json"),
    );
    const draft: Draft = { revision: 0, confirmed: true, book, records, sourceSha256 };
    write_json(path.join(directory, STATE), draft);
    return draft;
  });
}

async function writeback(directory: string, draft: Draft) {
  const text = fs.read_file(path.join(directory, "items.json"));
  const manifest = read_json<ImageWriteback>(path.join(directory, "image-writeback.json"));
  const records = JSON.parse(text.toString("utf8")) as ImageRecord[];
  if (
    manifest.version !== 1 ||
    !manifest.generationId ||
    manifest.sourceSha256 !== draft.sourceSha256 ||
    manifest.stateSha256 !== state_digest(draft) ||
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
    const snapshot = await writeback(path.resolve(options.writebackDirectory), draft);
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
      for (const group of page.groups)
        if (
          group.mask &&
          (await digest(path.join(directory, group.mask.path))) !== group.mask.sha256
        )
          throw new Error("Image mask changed");
      const repairKey = image_sha256(
        JSON.stringify({
          version: ALGORITHM_VERSION,
          source: [page.sha256, page.width, page.height, page.orientation],
          groups: page.groups,
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
        repair = (await pixels(
          "repair",
          { root: directory, source, page, output },
          options.device,
        )) as Repair;
        const artifacts: Record<string, string> = {};
        for (const file of [repair.base, ...repair.groups.map((group) => group.mask)])
          artifacts[file] = await digest(file);
        await fs.make_dir_async(repairDirectory);
        write_json(report, { result: repair, artifacts });
      }
      const layoutRegions = (await pixels("layout", {
        source,
        page,
        output: path.join(runDirectory, page.pageId + "-layout"),
      })) as LayoutRegion[];
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
              mask: region.mask,
              measurement: region.measurement,
              direction: intent.direction,
              style: intent.style,
              text: pageRecords.get(page.pageId + "/" + region.regionId)!.record.message,
            };
          }),
      };
      const layout = request.regions.length
        ? ((await workspace_requests().call(request)) as ImageLayoutResult)
        : { regions: [] };
      const groups: RunGroup[] = page.groups.map((group) => {
        const prepared = repair.groups.find((item) => item.groupId === group.groupId)!;
        const targets = group.regionIds.filter(
          (id) =>
            page.regions.find((region) => region.regionId === id)!.disposition === "translate",
        );
        const complete = targets.every((id) => pageRecords.get(page.pageId + "/" + id)?.completed);
        const ready =
          prepared.ready &&
          complete &&
          targets.every((id) => layout.regions.find((region) => region.regionId === id)?.ready);
        return {
          pageId: page.pageId,
          groupId: group.groupId,
          targeted: targets.length > 0,
          ready,
          reason: !prepared.ready
            ? prepared.reason
            : !complete
              ? "incomplete_text"
              : !ready
                ? "needs_layout"
                : null,
          mask: prepared.mask,
          tiles: ready
            ? targets.flatMap((id) => {
                const position = layoutRegions.find((region) => region.regionId === id)!;
                return layout.regions
                  .find((region) => region.regionId === id)!
                  .tiles.map((tile) => ({
                    ...tile,
                    x: tile.x + position.x,
                    y: tile.y + position.y,
                  }));
              })
            : [],
        };
      });
      const preview = path.join(runDirectory, "page-" + page.pageId + ".png");
      const composite = (await pixels("composite", {
        source,
        base: repair.base,
        output: preview,
        groups: groups.map((group) => ({ ...group, accepted: group.ready })),
      })) as { rejectedGroups: string[] };
      for (const group of groups)
        if (composite.rejectedGroups.includes(group.groupId)) {
          group.ready = false;
          group.reason = "text_collision";
          group.tiles = [];
        }
      execution.pages.push({ pageId: page.pageId, source, base: repair.base, preview, groups });
      for (const file of [
        source,
        repair.base,
        preview,
        ...groups.flatMap((group) => [group.mask, ...group.tiles.map((tile) => tile.path)]),
      ])
        execution.artifacts[file] = await digest(file);
    }
    write_json(path.join(runDirectory, "execution.json"), execution);
    return {
      executionId,
      generationId: snapshot.manifest.generationId,
      status: "draft" as const,
      pages: execution.pages.map((page) => ({
        pageId: page.pageId,
        preview: page.preview,
        groups: page.groups.map(({ groupId, ready, reason }) => ({ groupId, ready, reason })),
      })),
    };
  });
}

/** 发布新目录是唯一提交点，同执行身份重试读取已发布事实。 */
export async function publish(options: {
  workDirectory: string;
  executionId: string;
  outputDirectory: string;
  reviews: ImageReview[];
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
      const current = await writeback(execution.writebackDirectory, draft);
      if (JSON.stringify(current.manifest) !== JSON.stringify(execution.manifest))
        throw new Error("Generation changed after review");
      for (const [file, sha256] of Object.entries(execution.artifacts))
        if ((await digest(file)) !== sha256) throw new Error("Reviewed image artifact changed");
      const groups = execution.pages.flatMap((page) => page.groups);
      if (
        options.reviews.length !== groups.length ||
        new Set(options.reviews.map((review) => review.pageId + "/" + review.groupId)).size !==
          groups.length
      )
        throw new Error("Review every editing group exactly once");
      const decisions = groups.map((group) => {
        const review = options.reviews.find(
          (review) => review.pageId === group.pageId && review.groupId === group.groupId,
        );
        if (
          !review ||
          (review.decision !== "accept" && review.decision !== "preserve") ||
          (review.decision === "accept" && !group.ready)
        )
          throw new Error("Editing group is not ready for acceptance");
        return { ...group, accepted: review.decision === "accept" };
      });
      const temporary = path.join(parent, ".image-" + randomUUID());
      await fs.make_dir_exclusive(temporary);
      const pages = [];
      for (const [index, page] of execution.pages.entries()) {
        const name = `${String(index + 1).padStart(4, "0")}-${page.pageId}.png`;
        await pixels("composite", {
          source: page.source,
          base: page.base,
          output: path.join(temporary, name),
          groups: decisions.filter((group) => group.pageId === page.pageId),
        });
        pages.push({
          pageId: page.pageId,
          file: name,
          sha256: await digest(path.join(temporary, name)),
        });
      }
      const manifest = {
        executionId: execution.executionId,
        inputSha256: image_sha256(JSON.stringify(execution)),
        generation: execution.manifest,
        status: decisions.every((group) => group.accepted || !group.targeted)
          ? "complete"
          : "partial",
        pages,
        groups: decisions.map(({ pageId, groupId, accepted, reason }) => ({
          pageId,
          groupId,
          accepted,
          reason,
        })),
      };
      write_json(path.join(temporary, "delivery.json"), manifest);
      fs.rename(temporary, target);
      return { path: target, ...manifest };
    }),
  );
}
