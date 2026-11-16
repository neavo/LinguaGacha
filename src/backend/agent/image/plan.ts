import { randomUUID } from "node:crypto";
import path from "node:path";
import { Check } from "typebox/value";
import { default_native_fs as fs } from "../../../native/native-fs";
import {
  IMAGE_TEXT_INPUT_SCHEMA,
  IMAGE_TEXT_PLAN_SCHEMA,
  IMAGE_TEXT_ASSIGNMENT_SCHEMA,
  IMAGE_TEXT_RULES,
  normalize_image_text,
  type ImageTextInput,
  type ImageTextPlan,
  type ImageTextAssignment,
  type ImageTextSelection,
} from "../../../shared/image-text";
import { image_sha256, image_text_source_digest } from "../../file/image/image-format";
import { pixels } from "./engine";
import {
  locked,
  load_draft,
  read_json,
  write_json,
  file_exists,
  commit_directory,
  file_sha256,
  type Draft,
} from "./state";

/** 按块顺序还原固定全文，并让分界落在完整字素之间。 */
export function select_text(
  plan: ImageTextPlan,
  assignments: readonly ImageTextAssignment[],
): ImageTextSelection[][] {
  const pending = new Map<string, ImageTextAssignment>();
  for (const assignment of assignments) {
    if (!Check(IMAGE_TEXT_ASSIGNMENT_SCHEMA, assignment))
      throw new Error("Invalid text assignment");
    const id = JSON.stringify([assignment.pageId, assignment.regionId]);
    if (pending.has(id)) throw new Error("Duplicate text assignment");
    pending.set(id, assignment);
  }
  const selected = plan.pages.map((page) =>
    page.regions.map((region) => {
      const id = JSON.stringify([page.pageId, region.regionId]);
      const assignment = pending.get(id);
      pending.delete(id);
      const candidate = region.candidates.find(
        (c) =>
          c.candidateId ===
          (assignment?.candidateId ??
            (region.text === null || region.text === "" ? "C0" : region.recommendedCandidateId)),
      );
      if (!candidate) throw new Error(`Unknown text candidate: ${id}`);
      const supplied = assignment?.blocks;
      if (!supplied && candidate.blocks.length > 1)
        throw new Error(`Missing text assignment: ${id}`);
      const blocks = supplied ?? [
        { blockId: candidate.blocks[0]!.blockId, text: region.text ?? "" },
      ];
      const remaining = new Map(candidate.blocks.map((b) => [b.blockId, b]));
      const boundaries = new Set(
        [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(region.text ?? ""),
        ].map((s) => s.index),
      );
      boundaries.add((region.text ?? "").length);
      let length = 0;
      const result = blocks.map((block) => {
        const geometry = remaining.get(block.blockId);
        if (!geometry) throw new Error(`Unknown or duplicate text block: ${id}/${block.blockId}`);
        remaining.delete(block.blockId);
        length += block.text.length;
        if (!boundaries.has(length)) throw new Error(`Text assignment splits a grapheme: ${id}`);
        return { ...geometry, text: region.text === null ? null : block.text };
      });
      if (remaining.size || blocks.map((b) => b.text).join("") !== (region.text ?? ""))
        throw new Error(`Text assignment must conserve complete text and blocks: ${id}`);
      return {
        regionId: region.regionId,
        candidateId: candidate.candidateId,
        text: region.text,
        blocks: result,
      };
    }),
  );
  if (pending.size) throw new Error("Unknown text assignment region");
  return selected;
}

/** 计划路径只从固定目录解析，候选文件不接受调用者提供的路径。 */
export function plan_member(directory: string, member: string): string {
  const file = path.resolve(directory, member);
  const relative = path.relative(directory, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Invalid text plan member");
  return file;
}

/** 读取持久化计划时核对来源与材料，生成中的内存计划直接使用。 */
export async function read_text_plan(
  directory: string,
  planId: string,
  draft: Draft,
): Promise<ImageTextPlan> {
  if (!/^[a-f0-9]{64}$/u.test(planId)) throw new Error("Invalid planId");
  const root = path.join(directory, "text/plans", planId);
  const plan = read_json<ImageTextPlan>(path.join(root, "plan.json"));
  if (!Check(IMAGE_TEXT_PLAN_SCHEMA, plan)) throw new Error("Invalid text plan");
  const { planId: id, ...content } = plan;
  if (id !== planId || image_sha256(JSON.stringify(content)) !== id)
    throw new Error("Text plan identity mismatch");
  read_image_text_input(plan.input, draft);
  if (plan.pages.length !== draft.book.pages.length)
    throw new Error("Text plan page identity mismatch");
  for (const [index, page] of plan.pages.entries()) {
    const original = draft.book.pages[index]!;
    const records = plan.input.records.filter((record) => record.pageId === page.pageId);
    if (page.pageId !== original.pageId || page.regions.length !== records.length)
      throw new Error("Text plan region identity mismatch");
    for (const [index, region] of page.regions.entries()) {
      const record = records[index]!;
      if (
        region.regionId !== record.regionId ||
        region.text !== record.text ||
        new Set(region.candidates.map((candidate) => candidate.candidateId)).size !==
          region.candidates.length
      )
        throw new Error("Text plan region identity mismatch");
      for (const candidate of region.candidates) {
        if (
          new Set(candidate.blocks.map((block) => block.blockId)).size !== candidate.blocks.length
        )
          throw new Error("Text plan block identity mismatch");
      }
    }
  }
  let bytes = 0;
  for (const page of plan.pages)
    for (const region of page.regions)
      for (const candidate of region.candidates) {
        if ((await file_sha256(plan_member(root, candidate.preview))) !== candidate.previewSha256)
          throw new Error("Text candidate preview corrupted");
        for (const block of candidate.blocks) {
          const file = plan_member(
            candidate.candidateId === "C0" ? directory : root,
            block.selection.path,
          );
          bytes += fs.stat(file).size;
          if (
            bytes > IMAGE_TEXT_RULES.maximumMaterialBytes ||
            (await file_sha256(file)) !== block.selection.sha256
          )
            throw new Error("Text plan mask corrupted or exceeds budget");
        }
      }
  return plan;
}

/** 在草稿锁内生成候选；同一计划已存在时验证其持久化材料。 */
export async function prepare_text(options: {
  workDirectory: string;
  inputPath: string;
  expectedRevision: number;
}): Promise<ImageTextPlan> {
  const directory = path.resolve(options.workDirectory);
  return locked(directory, async () => {
    const draft = load_draft(directory);
    if (!draft.confirmed) throw new Error("Confirm image book before preparing text");
    if (draft.revision !== options.expectedRevision)
      throw new Error("Stale image draft revision; call read() and reconsider the operation");
    const input = read_image_text_input(read_json(options.inputPath), draft);
    input.records = input.records.map((record) => ({
      ...record,
      text: record.text === null ? null : normalize_image_text(record.text),
    }));
    const stage = path.join(directory, "text", `.plan-${randomUUID()}`);
    await fs.make_dir_async(path.dirname(stage));
    await fs.make_dir_exclusive(stage);
    try {
      let pixelsUsed = 0;
      const pages: ImageTextPlan["pages"] = [];
      for (const page of draft.book.pages) {
        const regions = (await pixels("text_plan", {
          root: directory,
          page,
          output: stage,
          maximumPixels: IMAGE_TEXT_RULES.maximumMaterialBytes,
        })) as ImageTextPlan["pages"][number]["regions"];
        for (const region of regions)
          for (const candidate of region.candidates)
            for (const block of candidate.blocks) {
              pixelsUsed += block.box[2] * block.box[3];
              if (pixelsUsed > IMAGE_TEXT_RULES.maximumMaterialBytes)
                throw new Error(
                  `Partition material budget exceeded: ${page.pageId}/${region.regionId}`,
                );
            }
        pages.push({
          pageId: page.pageId,
          originalPreview: page.original,
          regions: regions.map((region) => ({
            ...region,
            sourceText: draft.records.find(
              (r) => r.pageId === page.pageId && r.regionId === region.regionId,
            )!.message,
            text: input.records.find(
              (r) => r.pageId === page.pageId && r.regionId === region.regionId,
            )!.text,
          })),
        });
      }
      const content = { input, pages };
      const plan = { planId: image_sha256(JSON.stringify(content)), ...content };
      if (!Check(IMAGE_TEXT_PLAN_SCHEMA, plan)) throw new Error("Invalid generated text plan");
      const destination = path.join(directory, "text/plans", plan.planId);
      let verified = plan;
      if (file_exists(destination)) {
        verified = await read_text_plan(directory, plan.planId, draft);
      } else {
        write_json(path.join(stage, "plan.json"), plan);
        await fs.make_dir_async(path.dirname(destination));
        await commit_directory(stage, destination);
      }
      // 磁盘清单保持相对路径，返回值提供可直接查看的预览地址。
      return {
        ...verified,
        pages: verified.pages.map((page) => ({
          ...page,
          originalPreview: plan_member(directory, page.originalPreview),
          regions: page.regions.map((region) => ({
            ...region,
            candidates: region.candidates.map((candidate) => ({
              ...candidate,
              preview: plan_member(destination, candidate.preview),
            })),
          })),
        })),
      };
    } finally {
      await fs.remove_async(stage, { recursive: true, force: true });
    }
  });
}
/** 图片输入必须对应当前待译原文，数组顺序由稳定区域身份恢复。 */
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
        return { pageId: record.pageId, regionId: record.regionId, text: record.text };
      }),
  );
  if (byId.size) throw new Error("Unexpected image text region");
  return { bookId: value.bookId, sourceSha256: value.sourceSha256, records };
}
