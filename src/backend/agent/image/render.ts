import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as mupdf from "mupdf";
import { Check } from "typebox/value";
import { default_native_fs as fs } from "../../../native/native-fs";
import {
  IMAGE_TEXT_BLOCK_RESULT_SCHEMA,
  IMAGE_TEXT_PAGE_RESULT_SCHEMA,
  IMAGE_TEXT_RULES,
  IMAGE_TEXT_ENVIRONMENT_SCHEMA,
  normalize_image_text,
  type ImageTextInput,
  type ImageTextEnvironment,
  type ImageTextPage,
  type ImageTextHostResult,
  type ImageTextPageResult,
  type ImageTextRender,
  type ImageTextBlockResult,
  type ImageTextAssignment,
  type ImageTextSelection,
} from "../../../shared/image-text";
import type { ImageClean, ImagePage } from "../../../shared/image";
import { image_sha256 } from "../../file/image/image-format";
import { workspace_requests } from "../workspace/runtime/request-channel";
import { build_clean_manifest } from "./artifacts";
import { read_image_text_input, read_text_plan, select_text, plan_member } from "./plan";
import { pixels } from "./engine";
import {
  file_sha256,
  commit_directory,
  file_exists,
  load_draft,
  locked,
  read_json,
  write_json,
  type Draft,
} from "./state";

const SHA256 = /^[a-f0-9]{64}$/u;
/** 区域顺序属于书级清单，不参与页像素身份。 */
function sorted_regions<T extends { regionId: string }>(regions: readonly T[]): T[] {
  return [...regions].sort((a, b) =>
    a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
  );
}
type Geometry = Pick<
  ImageTextPage["regions"][number],
  "regionId" | "blockId" | "box" | "distance" | "centroid"
>;

/** 像素身份只消费本页的正文与几何事实，阅读顺序由书级输入及结果清单拥有。 */
export function image_text_page_digest(
  page: ImagePage,
  cleanSha256: string,
  records: readonly ImageTextInput["records"][number][],
  environment: ImageTextEnvironment,
  selected: readonly ImageTextSelection[] = [],
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
        maskSha256: region.selection!.sha256,
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
      selected: sorted_regions(selected),
      environment,
    }),
  );
}

/** 请求文件交给父进程校验，响应文件由本次调用负责回收。 */
async function call_host(
  inputPath: string | null,
): Promise<{ result: ImageTextHostResult; path: string }> {
  const response = await workspace_requests().call({
    kind: "render_image_text_page",
    inputPath,
    inputSha256: inputPath ? await file_sha256(inputPath) : null,
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

/** 固定当前快照后逐页计算；本次运行独立保存图片与材料，整体提交。 */
export async function render(options: {
  workDirectory: string;
  planId: string;
  assignments?: readonly ImageTextAssignment[];
  expectedRevision: number;
}): Promise<ImageTextRender> {
  const directory = path.resolve(options.workDirectory);
  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (!draft.confirmed) throw new Error("Confirm image book before rendering text");
    if (draft.revision !== options.expectedRevision)
      throw new Error("Stale image draft revision; call read() and reconsider the operation");
    const { clean, sources } = await build_clean_manifest(directory, draft);
    const plan = await read_text_plan(directory, options.planId, draft);
    const input = plan.input;
    const selected = select_text(plan, options.assignments ?? []);
    for (const regions of selected) {
      const bytes = regions.reduce(
        (sum, region) =>
          sum + region.blocks.reduce((total, block) => total + block.box[2] * block.box[3] * 4, 0),
        0,
      );
      if (bytes > IMAGE_TEXT_RULES.maximumMaterialBytes)
        throw new Error("Image text material exceeds byte budget");
    }
    const planDirectory = path.join(directory, "text/plans", plan.planId);
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
    const font = new mupdf.Font("ImageText", fontBytes);
    const stage = path.join(directory, "text", `.render-${randomUUID()}`);
    try {
      await fs.make_dir_async(path.dirname(stage));
      await fs.make_dir_exclusive(stage);
      const commit = path.join(stage, "run");
      await fs.make_dir_exclusive(commit);
      // 全部材料先验明，输入损坏不降为某页排版失败。
      const materials: {
        page: ImageTextPage;
        results: ImageTextBlockResult[];
        inputSha256: string;
        cleanSource: string;
      }[] = [];
      for (const [index, page] of draft.book.pages.entries()) {
        const geometry = page.regions.some((region) => region.disposition === "translate")
          ? ((await pixels("text_geometry", {
              root: directory,
              page,
              selected: selected[index],
              materials: planDirectory,
            })) as Geometry[])
          : [];
        const byId = new Map(
          geometry.map((region) => [JSON.stringify([region.regionId, region.blockId]), region]),
        );
        if (
          byId.size !== selected[index]!.reduce((count, region) => count + region.blocks.length, 0)
        )
          throw new Error("Image text geometry identity mismatch");
        const hostPage: ImageTextPage = {
          pageId: page.pageId,
          width: page.width,
          height: page.height,
          regions: [],
        };
        const results: ImageTextBlockResult[] = [];
        for (const selection of selected[index]!)
          for (const record of selection.blocks) {
            const region = page.regions.find((region) => region.regionId === selection.regionId)!;
            const shape = byId.get(JSON.stringify([selection.regionId, record.blockId]));
            if (!shape) throw new Error("Missing image text geometry");
            const base = {
              regionId: selection.regionId,
              blockId: record.blockId,
              text: record.text,
              box: shape.box,
            };
            if (record.text === null) results.push({ ...base, status: "untranslated" });
            else if (!record.text.trim()) results.push({ ...base, status: "blank" });
            else {
              const missing = [
                ...new Set(
                  Array.from(record.text.normalize("NFC")).filter(
                    (character) =>
                      !/[\p{Cc}\p{Cf}\p{Z}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u.test(character) &&
                      font.encodeCharacter(character) === 0,
                  ),
                ),
              ];
              if (missing.length)
                results.push({ ...base, status: "failed", reason: "missing_glyph", missing });
              else
                hostPage.regions.push({
                  ...shape,
                  text: record.text,
                  direction: region.direction!,
                  fill: { color: region.backgroundColor! },
                });
            }
          }
        const inputSha256 = image_text_page_digest(
          page,
          clean.pages[index]!.cleanSha256,
          input.records,
          environment,
          selected[index],
        );
        materials.push({
          page: hostPage,
          results,
          inputSha256,
          cleanSource: sources[clean.pages[index]!.clean]!,
        });
      }
      const pages: ImageTextPageResult[] = [];
      for (const [index, material] of materials.entries()) {
        const pageStage = path.join(stage, material.page.pageId);
        await fs.make_dir_exclusive(pageStage);
        const requestPath = path.join(pageStage, "request.json");
        write_json(requestPath, material.page);
        let painted: Awaited<ReturnType<typeof call_host>> | undefined;
        try {
          try {
            if (material.page.regions.length) painted = await call_host(requestPath);
          } catch (cause) {
            const error = cause instanceof Error ? cause.message : String(cause);
            if (
              /Line isolation|Isolated line coverage|font unavailable|DPR 1|Native text raster changed/u.test(
                error,
              )
            )
              throw cause;
            pages.push({
              pageId: material.page.pageId,
              inputSha256: material.inputSha256,
              status: "error",
              regions: group_results(selected[index]!, material.results, true),
              error,
            });
            continue;
          }
          const paint = painted?.result ?? { environment, regions: [] };
          if (
            !isDeepStrictEqual(paint.environment, environment) ||
            paint.regions.length !== material.page.regions.length
          )
            throw new Error("Image text result identity mismatch");
          const expected = new Map(
            material.page.regions.map((region) => [
              JSON.stringify([region.regionId, region.blockId]),
              region,
            ]),
          );
          for (const entry of paint.regions) {
            const region = expected.get(
              JSON.stringify([entry.result.regionId, entry.result.blockId]),
            );
            if (
              !region ||
              !Check(IMAGE_TEXT_BLOCK_RESULT_SCHEMA, entry.result) ||
              entry.result.text !== region.text ||
              !isDeepStrictEqual(entry.result.box, region.box) ||
              (entry.result.status !== "rendered" && entry.result.status !== "failed") ||
              (entry.result.status === "rendered"
                ? typeof entry.png !== "string" || !entry.png
                : entry.png !== undefined)
            )
              throw new Error("Image text result region mismatch");
            expected.delete(JSON.stringify([entry.result.regionId, entry.result.blockId]));
          }
          const paintPath = path.join(pageStage, "paint.json");
          write_json(paintPath, paint);
          const composed = paint.regions.some((entry) => entry.result.status === "rendered")
            ? ((await pixels("text_compose", {
                root: directory,
                page: draft.book.pages[index],
                selected: selected[index],
                materials: planDirectory,
                source: material.cleanSource,
                paint: paintPath,
                rules: IMAGE_TEXT_RULES,
                output: path.join(pageStage, "preview.png"),
              })) as { preview: string; previewSha256: string })
            : { preview: material.cleanSource, previewSha256: clean.pages[index]!.cleanSha256 };
          const regions = group_results(selected[index]!, [
            ...material.results,
            ...paint.regions.map((entry) => entry.result),
          ]);
          const preview = `pages/${material.page.pageId}.png`;
          const result: ImageTextPageResult = {
            pageId: material.page.pageId,
            inputSha256: material.inputSha256,
            status: regions.every((region) =>
              region.blocks.every(
                (block) => block.status === "rendered" || block.status === "blank",
              ),
            )
              ? "ready"
              : "incomplete",
            regions,
            preview,
            previewSha256: composed.previewSha256,
          };
          fs.copy_file(composed.preview, plan_member(commit, preview));
          pages.push(result);
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
      write_json(path.join(commit, "selected.json"), selected);
      for (const page of selected)
        for (const region of page)
          for (const block of region.blocks) {
            const source = plan_member(
              region.candidateId === "C0" ? directory : planDirectory,
              block.selection.path,
            );
            fs.copy_file(source, plan_member(path.join(commit, "masks"), block.selection.path));
          }
      write_json(path.join(commit, "render.json"), run);
      if (file_exists(runDirectory)) {
        // 内容相同的运行可以共用身份，但已有产物仍须完整；损坏时由 Agent 清理后重做。
        await read_image_text_render(directory, draft, renderId, clean);
      } else {
        await fs.make_dir_async(path.dirname(runDirectory));
        await commit_directory(commit, runDirectory);
      }
      // 磁盘清单使用运行内相对路径，工具回执提供可直接查看的文件路径。
      return {
        ...run,
        pages: run.pages.map((page) => ({
          ...page,
          ...(page.preview ? { preview: plan_member(runDirectory, page.preview) } : {}),
        })),
      };
    } finally {
      font.destroy();
      await fs.remove_async(stage, { recursive: true, force: true });
    }
  });
}

/** 发布只消费同一份不可变结果；当前草稿与来源仍必须匹配。 */
export async function read_image_text_render(
  directory: string,
  draft: Draft,
  renderId: string,
  clean: ImageClean,
) {
  if (!SHA256.test(renderId)) throw new Error("Invalid renderId");
  const runDirectory = path.join(directory, "text/runs", renderId);
  const input = read_image_text_input(read_json(path.join(runDirectory, "input.json")), draft);
  const selected = read_json<ImageTextSelection[][]>(path.join(runDirectory, "selected.json"));
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
        selected[index],
      )
    )
      throw new Error("Image text result no longer matches the reviewed base");
    if (page.status !== "error") {
      const expected = group_results(
        selected[index]!,
        page.regions.flatMap((region) => region.blocks),
      );
      if (
        !isDeepStrictEqual(expected, page.regions) ||
        page.status !==
          (expected.every((region) =>
            region.blocks.every((block) => block.status === "rendered" || block.status === "blank"),
          )
            ? "ready"
            : "incomplete")
      )
        throw new Error("Image text block completeness mismatch");
      if (
        page.preview !== `pages/${page.pageId}.png` ||
        !page.previewSha256 ||
        !file_exists(plan_member(runDirectory, page.preview)) ||
        (await file_sha256(plan_member(runDirectory, page.preview))) !== page.previewSha256
      )
        throw new Error(
          `Image text run page missing or corrupted: ${page.pageId}; remove the damaged run and render again`,
        );
    }
  }
  for (const page of selected)
    for (const region of page)
      for (const block of region.blocks) {
        if (
          (await file_sha256(
            plan_member(path.join(runDirectory, "masks"), block.selection.path),
          )) !== block.selection.sha256
        )
          throw new Error("Text run mask corrupted");
      }
  return { input, run, selected, runDirectory };
}

/** 按本次分配顺序汇总块；宿主整页失败时允许只保留已确定的块状态。 */
function group_results(
  selected: readonly ImageTextSelection[],
  results: readonly ImageTextBlockResult[],
  partial = false,
): ImageTextPageResult["regions"] {
  const byId = new Map(
    results.map((result) => [JSON.stringify([result.regionId, result.blockId]), result]),
  );
  return selected.map((region) => ({
    regionId: region.regionId,
    text: region.text,
    candidateId: region.candidateId,
    blocks: region.blocks.flatMap((block) => {
      const result = byId.get(JSON.stringify([region.regionId, block.blockId]));
      if (!result && !partial) throw new Error("Missing text block result");
      return result ? [result] : [];
    }),
  }));
}
