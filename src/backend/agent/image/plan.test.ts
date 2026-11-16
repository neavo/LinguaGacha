import { expect, it } from "vitest";
import { select_text, plan_member, read_image_text_input } from "./plan";
import type { ImageTextPlan } from "../../../shared/image-text";
import { image_fixture } from "../../../test/image-fixture";
import { image_text_source_digest } from "../../file/image/image-format";

/** 两个候选共用正文，测试只改变分配边界。 */
function plan(text: string | null): ImageTextPlan {
  const block = {
    blockId: "B1",
    box: [0, 0, 10, 10] as [number, number, number, number],
    areaShare: 1,
    selection: { path: "mask.png", sha256: "a".repeat(64) },
  };
  return {
    planId: "a".repeat(64),
    input: {
      bookId: "book",
      sourceSha256: "a".repeat(64),
      records: [{ pageId: "p", regionId: "r", text }],
    },
    pages: [
      {
        pageId: "p",
        originalPreview: "original.png",
        regions: [
          {
            regionId: "r",
            sourceText: "原文",
            text,
            recommendedCandidateId: "C1",
            candidates: [
              {
                candidateId: "C0",
                preview: "whole.png",
                previewSha256: "a".repeat(64),
                blocks: [block],
              },
              {
                candidateId: "C1",
                preview: "split.png",
                previewSha256: "a".repeat(64),
                blocks: [block, { ...block, blockId: "B2" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

it("输入按当前原稿顺序归一，拒绝缺失、重复、额外区域与过期原文", () => {
  const { book, records } = image_fixture();
  const draft = { book, records, revision: 0, confirmed: true };
  const input = {
    bookId: book.bookId,
    sourceSha256: image_text_source_digest(book, records),
    records: records.map(({ pageId, regionId }) => ({ pageId, regionId, text: null })),
  };
  expect(read_image_text_input({ ...input, records: [...input.records].reverse() }, draft)).toEqual(
    input,
  );
  for (const rows of [
    input.records.slice(1),
    [...input.records, input.records[0]],
    [...input.records, { pageId: "extra", regionId: "text", text: "" }],
  ])
    expect(() => read_image_text_input({ ...input, records: rows }, draft)).toThrow();
  records[0]!.message = "changed";
  expect(() => read_image_text_input(input, draft)).toThrow("source mismatch");
  // 保留项可有可读原文，但写字输入只包含待译项。
  Object.assign(book.pages[1]!.regions[0]!, {
    disposition: "preserve",
    preserveReason: "repair_failed",
    backgroundColor: null,
    direction: null,
  });
  input.sourceSha256 = image_text_source_digest(book, records);
  input.records = input.records.slice(0, 1);
  expect(read_image_text_input(input, draft).records).toEqual(input.records);
});
it("固定全文允许跨句、空块和重排，严格保留空格与字素边界", () => {
  for (const parts of [
    ["因为昨天下雨，", "所以没有出门。"],
    ["hello ", "world"],
    ["café", " 👨‍👩‍👧‍👦"],
    ["第一段\n\n", "第二段"],
    ["", "完整正文"],
  ]) {
    const selected = select_text(plan(parts.join("")), [
      {
        pageId: "p",
        regionId: "r",
        candidateId: "C1",
        blocks: [
          { blockId: "B2", text: parts[0]! },
          { blockId: "B1", text: parts[1]! },
        ],
      },
    ]);
    expect(selected[0]![0]!.blocks.map((b) => b.text)).toEqual(parts);
    expect(selected[0]![0]!.blocks.map((b) => b.blockId)).toEqual(["B2", "B1"]);
  }
  expect(() => select_text(plan("hello world"), [])).toThrow("Missing");
  expect(
    select_text(plan("hello world"), [{ pageId: "p", regionId: "r", candidateId: "C0" }])[0]![0]!
      .blocks[0]!.text,
  ).toBe("hello world");
  expect(select_text(plan(null), [])[0]![0]!.blocks[0]!.text).toBeNull();
  expect(select_text(plan(""), [])[0]![0]!.blocks[0]!.text).toBe("");
});
it("拒绝未知、重复、缺少身份以及增删文字或拆开字素", () => {
  const assignment = {
    pageId: "p",
    regionId: "r",
    candidateId: "C1",
    blocks: [
      { blockId: "B1", text: "hello " },
      { blockId: "B2", text: "world" },
    ],
  };
  for (const blocks of [
    assignment.blocks.slice(1),
    [assignment.blocks[0]!, assignment.blocks[0]!],
    [{ blockId: "unknown", text: "hello " }, assignment.blocks[1]!],
    [{ blockId: "B1", text: "hello" }, assignment.blocks[1]!],
  ])
    expect(() => select_text(plan("hello world"), [{ ...assignment, blocks }])).toThrow();
  expect(() => select_text(plan("hello world"), [assignment, assignment])).toThrow("Duplicate");
  expect(() =>
    select_text(plan("hello world"), [{ ...assignment, candidateId: "unknown" }]),
  ).toThrow("Unknown");
  expect(() =>
    select_text(plan("é"), [
      {
        ...assignment,
        blocks: [
          { blockId: "B1", text: "e" },
          { blockId: "B2", text: "́" },
        ],
      },
    ]),
  ).toThrow("grapheme");
  expect(() =>
    select_text(plan(null), [
      { ...assignment, candidateId: "C0", blocks: [{ blockId: "B1", text: "fabricated" }] },
    ]),
  ).toThrow();
  expect(() => plan_member("E:/work/plan", "../outside.png")).toThrow("member");
});
