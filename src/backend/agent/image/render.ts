import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Check } from "typebox/value";
import { default_native_fs as fs } from "../../../native/native-fs";
import {
  IMAGE_TEXT_BLOCK_RESULT_SCHEMA,
  IMAGE_TEXT_ENVIRONMENT_SCHEMA,
  IMAGE_TEXT_INPUT_SCHEMA,
  IMAGE_TEXT_PAGE_RESULT_SCHEMA,
  IMAGE_TEXT_RULES,
  normalize_image_text,
  type ImageTextBlockResult,
  type ImageTextEnvironment,
  type ImageTextHostResult,
  type ImageTextInput,
  type ImageTextPage,
  type ImageTextPageResult,
  type ImageTextRegionResult,
  type ImageTextRender,
} from "../../../shared/image-text";
import type { ImageClean, ImagePage, ImageRegion } from "../../../shared/image";
import { image_sha256, image_text_source_digest } from "../../file/image/image-format";
import { workspace_requests } from "../workspace/runtime/request-channel";
import { build_clean_manifest } from "./artifacts";
import { pixels } from "./engine";
import {
  commit_directory,
  file_exists,
  file_sha256,
  load_draft,
  locked,
  read_json,
  write_json,
  type Draft,
} from "./state";

const SHA256 = /^[a-f0-9]{64}$/u;
type GeometryRegion = Pick<ImageTextPage["regions"][number], "regionId" | "candidates">;
/** 仅在本次排版与合成期间携带距离场，不写入运行记录。 */
type GeometrySelection = {
  regionId: string;
  candidateId: string;
  text: string | null;
  blocks: (ImageTextPage["regions"][number]["candidates"][number]["blocks"][number] & {
    text: string | null;
  })[];
};

function sorted_regions<T extends { regionId: string }>(regions: readonly T[]): T[] {
  return [...regions].sort((a, b) =>
    a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
  );
}

/** 像素身份消费本页正文、排版区域、实际排版结果及原生环境。 */
export function image_text_page_digest(
  page: ImagePage,
  cleanSha256: string,
  records: readonly ImageTextInput["records"][number][],
  environment: ImageTextEnvironment,
  results: readonly ImageTextRegionResult[] = [],
): string {
  return image_sha256(
    JSON.stringify({
      pageId: page.pageId,
      cleanSha256,
      width: page.width,
      height: page.height,
      regions: sorted_regions(
        page.regions.filter((region) => region.disposition === "translate"),
      ).map((region) => ({
        regionId: region.regionId,
        textBoxIds: region.textBoxIds,
        layoutAreaSha256: region.layoutArea!.sha256,
        direction: region.direction,
        color: region.backgroundColor!,
      })),
      records: sorted_regions(
        records
          .filter((record) => record.pageId === page.pageId)
          .map((record) => ({
            pageId: record.pageId,
            regionId: record.regionId,
            text: record.text === null ? null : normalize_image_text(record.text),
          })),
      ),
      results: sorted_regions(results),
      environment,
    }),
  );
}

async function call_host(
  inputPath: string | null,
): Promise<{ result: ImageTextHostResult; path: string }> {
  const response = await workspace_requests().call({
    kind: "render_image_text_page",
    inputPath,
  });
  if (!response || typeof response !== "object" || !("path" in response))
    throw new Error("Invalid image text host response");
  try {
    return { result: read_json<ImageTextHostResult>(response.path), path: response.path };
  } catch (error) {
    fs.unlink(response.path, { force: true });
    throw error;
  }
}

export function run_member(directory: string, member: string): string {
  const file = path.resolve(directory, member);
  const relative = path.relative(directory, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Invalid image text run member");
  return file;
}

export function read_image_text_input(value: unknown, draft: Draft): ImageTextInput {
  if (!Check(IMAGE_TEXT_INPUT_SCHEMA, value)) throw new Error("Invalid image text input");
  if (
    value.bookId !== draft.book.bookId ||
    value.sourceSha256 !== image_text_source_digest(draft.book, draft.records)
  )
    throw new Error("Image text source mismatch; generate current input again");
  const byId = new Map<string, ImageTextInput["records"][number]>();
  for (const record of value.records) {
    const id = JSON.stringify([record.pageId, record.regionId]);
    if (byId.has(id)) throw new Error("Duplicate image text region");
    byId.set(id, record);
  }
  const records = draft.book.pages.flatMap((page) =>
    page.regions
      .filter((region) => region.disposition === "translate")
      .map((region) => {
        const id = JSON.stringify([page.pageId, region.regionId]);
        const record = byId.get(id);
        if (!record) throw new Error(`Missing image text region: ${id}`);
        byId.delete(id);
        return {
          pageId: record.pageId,
          regionId: record.regionId,
          text: record.text === null ? null : normalize_image_text(record.text),
        };
      }),
  );
  if (byId.size) throw new Error("Unexpected image text region");
  return { bookId: value.bookId, sourceSha256: value.sourceSha256, records };
}

function center(box: ImagePage["textBoxes"][number]["coreBox"]): [number, number] {
  return [
    box.reduce((sum, point) => sum + point[0], 0) / box.length,
    box.reduce((sum, point) => sum + point[1], 0) / box.length,
  ];
}

function edge(pointA: readonly number[], pointB: readonly number[]): number {
  return Math.hypot(pointA[0]! - pointB[0]!, pointA[1]! - pointB[1]!);
}

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

function blank_selection(
  region: ImageRegion,
  geometry: GeometryRegion,
  text: string | null,
): { selected: GeometrySelection; result: ImageTextBlockResult } {
  const candidate = geometry.candidates[0]!;
  const block = candidate.blocks[0]!;
  return {
    selected: {
      regionId: region.regionId,
      candidateId: candidate.candidateId,
      text,
      blocks: candidate.blocks.map((item, index) => ({
        ...item,
        text: index === 0 ? text : "",
      })),
    },
    result: {
      regionId: region.regionId,
      candidateId: candidate.candidateId,
      blockId: block.blockId,
      text,
      box: block.box,
      status: text === null ? "untranslated" : "blank",
    },
  };
}

function read_rendered_region(
  region: ImageRegion,
  geometry: GeometryRegion,
  text: string,
  paints: ImageTextHostResult["regions"],
): { selected: GeometrySelection; results: ImageTextBlockResult[] } {
  if (!paints.length) throw new Error("Missing image text result region");
  const candidateId = paints[0]!.result.candidateId;
  if (paints.some((paint) => paint.result.candidateId !== candidateId))
    throw new Error("Image text result mixes candidates");
  const candidate = geometry.candidates.find((item) => item.candidateId === candidateId);
  if (!candidate) throw new Error("Unknown automatic text candidate");
  const byBlock = new Map(candidate.blocks.map((block) => [block.blockId, block]));
  const seen = new Set<string>();
  for (const paint of paints) {
    const block = byBlock.get(paint.result.blockId);
    if (
      !block ||
      seen.has(paint.result.blockId) ||
      !Check(IMAGE_TEXT_BLOCK_RESULT_SCHEMA, paint.result) ||
      !isDeepStrictEqual(block.box, paint.result.box) ||
      (paint.result.status === "rendered" ? !paint.png : paint.png !== undefined)
    )
      throw new Error("Image text result block mismatch");
    seen.add(paint.result.blockId);
  }
  const rendered = paints.every((paint) => paint.result.status === "rendered");
  if (rendered && paints.length !== candidate.blocks.length)
    throw new Error("Image text result omitted a rendered block");
  if (
    rendered &&
    new Set(
      paints.map((paint) =>
        paint.result.status === "rendered" ? paint.result.fontSize : undefined,
      ),
    ).size !== 1
  )
    throw new Error("Image text candidate blocks must share one font size");
  const textByBlock = new Map(
    paints.map((paint) => [paint.result.blockId, paint.result.text ?? ""]),
  );
  if (
    rendered &&
    candidate.blocks.map((block) => textByBlock.get(block.blockId) ?? "").join("") !== text
  )
    throw new Error("Automatic text layout must conserve complete text");
  return {
    selected: {
      regionId: region.regionId,
      candidateId,
      text,
      blocks: candidate.blocks.map((block, index) => ({
        ...block,
        text: textByBlock.get(block.blockId) ?? (index === 0 ? text : ""),
      })),
    },
    results: paints.map((paint) => paint.result),
  };
}

/** 固定正文快照后自动生成几何、规划排版并逐页提交不可变结果。 */
export async function render(options: {
  workDirectory: string;
  inputPath: string;
  expectedRevision: number;
}): Promise<ImageTextRender> {
  const directory = path.resolve(options.workDirectory);
  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (!draft.confirmed) throw new Error("Confirm image book before rendering text");
    if (draft.revision !== options.expectedRevision)
      throw new Error("Stale image draft revision; call read() and reconsider the operation");
    const input = read_image_text_input(read_json(options.inputPath), draft);
    const { clean, sources } = await build_clean_manifest(directory, draft);
    const environmentResponse = await call_host(null);
    const environment = environmentResponse.result.environment;
    fs.unlink(environmentResponse.path, { force: true });
    if (!Check(IMAGE_TEXT_ENVIRONMENT_SCHEMA, environment))
      throw new Error("Invalid image text environment");
    const runtime = globalThis as typeof globalThis & { ws?: { fontsDirectory: string } };
    if (!runtime.ws) throw new Error("Current process has no workspace fonts");
    const fontBytes = fs.read_file(path.join(runtime.ws.fontsDirectory, IMAGE_TEXT_RULES.fontFile));
    if (image_sha256(fontBytes) !== environment.fontSha256)
      throw new Error("Image text font identity mismatch");
    const stage = path.join(directory, "text", `.render-${randomUUID()}`);
    try {
      await fs.make_dir_async(path.dirname(stage));
      await fs.make_dir_exclusive(stage);
      const commit = path.join(stage, "run");
      await fs.make_dir_exclusive(commit);
      const pages: ImageTextPageResult[] = [];
      for (const [pageIndex, page] of draft.book.pages.entries()) {
        const geometry = page.regions.some((region) => region.disposition === "translate")
          ? ((await pixels("text_layout", {
              root: directory,
              page,
              maximumBytes: IMAGE_TEXT_RULES.maximumMaterialBytes,
            })) as GeometryRegion[])
          : [];
        const geometryById = new Map(geometry.map((region) => [region.regionId, region]));
        const pageStage = path.join(stage, page.pageId);
        await fs.make_dir_exclusive(pageStage);
        const hostPage: ImageTextPage = {
          pageId: page.pageId,
          width: page.width,
          height: page.height,
          regions: [],
        };
        const records = input.records.filter((record) => record.pageId === page.pageId);
        for (const region of page.regions.filter((item) => item.disposition === "translate")) {
          const text = records.find((record) => record.regionId === region.regionId)!.text;
          const shape = geometryById.get(region.regionId);
          if (!shape) throw new Error("Missing image text geometry");
          if (text !== null && text.trim())
            hostPage.regions.push({
              regionId: region.regionId,
              text,
              direction: region.direction!,
              fill: { color: region.backgroundColor! },
              ...source_layout(page, region),
              candidates: shape.candidates,
            });
        }
        const requestPath = path.join(pageStage, "request.json");
        write_json(requestPath, hostPage);
        let painted: Awaited<ReturnType<typeof call_host>> | undefined;
        try {
          if (hostPage.regions.length) painted = await call_host(requestPath);
          const paint = painted?.result ?? { environment, regions: [] };
          if (!isDeepStrictEqual(paint.environment, environment))
            throw new Error("Image text result environment mismatch");
          const selected: GeometrySelection[] = [];
          const regionResults: ImageTextPageResult["regions"] = [];
          for (const region of page.regions.filter((item) => item.disposition === "translate")) {
            const text = records.find((record) => record.regionId === region.regionId)!.text;
            const shape = geometryById.get(region.regionId)!;
            if (text === null || !text.trim()) {
              const blank = blank_selection(region, shape, text);
              selected.push(blank.selected);
              regionResults.push({
                regionId: region.regionId,
                text,
                candidateId: blank.selected.candidateId,
                blocks: [blank.result],
              });
              continue;
            }
            const entries = paint.regions.filter(
              (entry) => entry.result.regionId === region.regionId,
            );
            const rendered = read_rendered_region(region, shape, text, entries);
            selected.push(rendered.selected);
            regionResults.push({
              regionId: region.regionId,
              text,
              candidateId: rendered.selected.candidateId,
              blocks: rendered.results,
            });
          }
          const paintPath = path.join(pageStage, "paint.json");
          write_json(paintPath, paint);
          const composed = paint.regions.some((entry) => entry.result.status === "rendered")
            ? ((await pixels("text_compose", {
                root: directory,
                page,
                selected,
                source: sources[clean.pages[pageIndex]!.clean]!,
                paint: paintPath,
                rules: IMAGE_TEXT_RULES,
                output: path.join(pageStage, "preview.png"),
              })) as { preview: string; previewSha256: string })
            : {
                preview: sources[clean.pages[pageIndex]!.clean]!,
                previewSha256: clean.pages[pageIndex]!.cleanSha256,
              };
          const preview = `pages/${page.pageId}.png`;
          const status = regionResults.every((region) =>
            region.blocks.every((block) => block.status === "rendered" || block.status === "blank"),
          )
            ? "rendered"
            : "incomplete";
          const inputSha256 = image_text_page_digest(
            page,
            clean.pages[pageIndex]!.cleanSha256,
            input.records,
            environment,
            regionResults,
          );
          pages.push({
            pageId: page.pageId,
            inputSha256,
            status,
            regions: regionResults,
            preview,
            previewSha256: composed.previewSha256,
          });
          fs.copy_file(composed.preview, run_member(commit, preview));
        } catch (cause) {
          if (painted) throw cause;
          const error = cause instanceof Error ? cause.message : String(cause);
          pages.push({
            pageId: page.pageId,
            inputSha256: image_text_page_digest(
              page,
              clean.pages[pageIndex]!.cleanSha256,
              input.records,
              environment,
              [],
            ),
            status: "error",
            regions: [],
            error,
          });
        } finally {
          if (painted) fs.unlink(painted.path, { force: true });
        }
      }
      const manifest = {
        bookId: input.bookId,
        sourceSha256: input.sourceSha256,
        environment,
        pages,
      };
      const renderId = image_sha256(JSON.stringify(manifest));
      const run: ImageTextRender = { ...manifest, renderId };
      const runDirectory = path.join(directory, "text/runs", renderId);
      write_json(path.join(commit, "input.json"), input);
      write_json(path.join(commit, "render.json"), run);
      if (file_exists(runDirectory))
        await read_image_text_render(directory, draft, renderId, clean);
      else {
        await fs.make_dir_async(path.dirname(runDirectory));
        await commit_directory(commit, runDirectory);
      }
      return {
        ...run,
        pages: run.pages.map((page) => ({
          ...page,
          ...(page.preview ? { preview: run_member(runDirectory, page.preview) } : {}),
        })),
      };
    } finally {
      await fs.remove_async(stage, { recursive: true, force: true });
    }
  });
}

export async function read_image_text_render(
  directory: string,
  draft: Draft,
  renderId: string,
  clean: ImageClean,
) {
  if (!SHA256.test(renderId)) throw new Error("Invalid renderId");
  const runDirectory = path.join(directory, "text/runs", renderId);
  const input = read_image_text_input(read_json(path.join(runDirectory, "input.json")), draft);
  const run = read_json<ImageTextRender>(path.join(runDirectory, "render.json"));
  const { renderId: _id, ...manifest } = run;
  if (
    !Check(IMAGE_TEXT_ENVIRONMENT_SCHEMA, run.environment) ||
    run.renderId !== renderId ||
    image_sha256(JSON.stringify(manifest)) !== renderId ||
    run.bookId !== input.bookId ||
    run.sourceSha256 !== input.sourceSha256 ||
    run.pages.length !== draft.book.pages.length
  )
    throw new Error("Image text run identity mismatch");
  for (const [index, page] of run.pages.entries()) {
    if (
      !Check(IMAGE_TEXT_PAGE_RESULT_SCHEMA, page) ||
      page.pageId !== draft.book.pages[index]!.pageId
    )
      throw new Error("Invalid image text page result");
    if (
      page.inputSha256 !==
      image_text_page_digest(
        draft.book.pages[index]!,
        clean.pages[index]!.cleanSha256,
        input.records,
        run.environment,
        page.regions,
      )
    )
      throw new Error("Image text result no longer matches the reviewed base");
    if (page.status === "error") continue;
    const expectedStatus = page.regions.every((region) =>
      region.blocks.every((block) => block.status === "rendered" || block.status === "blank"),
    )
      ? "rendered"
      : "incomplete";
    if (page.status !== expectedStatus) throw new Error("Image text block completeness mismatch");
    if (
      page.preview !== `pages/${page.pageId}.png` ||
      !page.previewSha256 ||
      !file_exists(run_member(runDirectory, page.preview)) ||
      (await file_sha256(run_member(runDirectory, page.preview))) !== page.previewSha256
    )
      throw new Error(`Image text run page missing or corrupted: ${page.pageId}`);
  }
  return { run, input, runDirectory };
}
