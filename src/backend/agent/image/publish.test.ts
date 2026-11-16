import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { default_native_fs } from "../../../native/native-fs";
import { image_fixture } from "../../../test/image-fixture";
import { image_sha256, image_text_source_digest } from "../../file/image/image-format";
import type {
  ImageTextHostResult,
  ImageTextInput,
  ImageTextPage,
} from "../../../shared/image-text";
import { IMAGE_TEXT_RULES } from "../../../shared/image-text";
import { bind_workspace_requests } from "../workspace/runtime/request-channel";
import { render } from "./render";
import { review_artifact_digest, type ReviewRecord, type Draft } from "./state";
import { restore, apply } from "./index";
import { prepare_text } from "./plan";
import { publish } from "./publish";

vi.mock("./engine", () => ({
  pixels: vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === "text_plan") {
      const page = args.page as import("../../../shared/image").ImagePage;
      return page.regions
        .filter((r) => r.disposition === "translate")
        .map((r) => {
          const preview = page.pageId + "/" + r.regionId + ".png";
          fs.mkdirSync(path.dirname(path.join(String(args.output), preview)), { recursive: true });
          fs.writeFileSync(path.join(String(args.output), preview), "preview");
          return {
            regionId: r.regionId,
            recommendedCandidateId: "C0",
            candidates: [
              {
                candidateId: "C0",
                preview,
                previewSha256: image_sha256("preview"),
                blocks: [
                  { blockId: "B1", box: [0, 0, 1, 1], areaShare: 1, selection: r.selection },
                ],
              },
            ],
          };
        });
    }
    if (command === "text_geometry") {
      const page = args.page as ImageTextPage;
      const distance = Buffer.alloc(4);
      distance.writeFloatLE(1);
      return page.regions
        .filter(
          (region) => (region as unknown as { disposition: string }).disposition === "translate",
        )
        .map((region) => ({
          regionId: region.regionId,
          blockId: "B1",
          box: [0, 0, 1, 1],
          centroid: [0.5, 0.5],
          distance: distance.toString("base64"),
        }));
    }
    if (command === "text_compose") {
      fs.copyFileSync(String(args.source), String(args.output));
      return {
        preview: args.output,
        previewSha256: image_sha256(fs.readFileSync(String(args.output))),
      };
    }
    throw new Error(`Unexpected pixel command: ${command}`);
  }),
}));

it("运行产物、当前来源和视觉决定共同约束完整或部分发布", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-render-"));
  const source = path.join(temporary.path, "source"),
    work = path.join(temporary.path, "work");
  const fixture = image_fixture(["blank", "text", "missing", "untranslated"]);
  for (const [file, value] of [
    ["image.json", fixture.book],
    ["items.json", fixture.records],
    ["clean.json", fixture.clean],
  ] as const) {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, file), JSON.stringify(value));
  }
  for (const page of fixture.book.pages) {
    for (const [file, bytes] of [
      [page.original, fixture.original],
      [`clean/${page.pageId}.png`, fixture.original],
      [page.regions[0]!.selection!.path, fixture.mask],
    ] as const) {
      fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
      fs.writeFileSync(path.join(source, file), bytes);
    }
  }
  const draft = await restore(source, work);
  const input: ImageTextInput = {
    bookId: fixture.book.bookId,
    sourceSha256: image_text_source_digest(draft.book, draft.records),
    records: fixture.records.map((record, index) => ({
      pageId: record.pageId,
      regionId: record.regionId,
      text: ["", "A", "\u{10FFFF}", null][index]!,
    })),
  };
  const inputPath = path.join(temporary.path, "input.json");
  fs.writeFileSync(inputPath, JSON.stringify(input));
  const fontsDirectory = path.resolve("public/fonts");
  vi.stubGlobal("ws", { fontsDirectory });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const fontSha256 = image_sha256(
    fs.readFileSync(path.join(fontsDirectory, IMAGE_TEXT_RULES.fontFile)),
  );
  let renders = 0;
  let failPage = false;
  bind_workspace_requests({
    call: async (request) => {
      if (request.kind !== "render_image_text_page")
        throw new Error("Unexpected workspace request");
      const page = request.inputPath
        ? (JSON.parse(fs.readFileSync(request.inputPath, "utf8")) as ImageTextPage)
        : null;
      if (page) renders++;
      if (page && failPage) {
        failPage = false;
        throw new Error("fixture renderer crashed");
      }
      const result: ImageTextHostResult = {
        environment: {
          fontSha256,
          rendererSha256: "a".repeat(64),
          chromium: "fixture",
          platform: process.platform,
          arch: process.arch,
          raster: "chromium-native-dpr1",
        },
        regions:
          page?.regions.map((region) => ({
            result: {
              regionId: region.regionId,
              blockId: "B1",
              text: region.text,
              box: region.box,
              status: "failed",
              reason: "no_fit",
            },
          })) ?? [],
      };
      const file = path.join(temporary.path, `response-${renders}.json`);
      fs.writeFileSync(file, JSON.stringify(result));
      return { path: file };
    },
  });
  let revision = 0;
  const prepared = await prepare_text({
    workDirectory: work,
    inputPath,
    expectedRevision: revision,
  });
  await expect(
    render({ workDirectory: work, planId: prepared.planId, expectedRevision: 1 }),
  ).rejects.toThrow("Stale");
  await expect(
    render({
      workDirectory: work,
      planId: prepared.planId,
      expectedRevision: revision,
      assignments: [{ pageId: "text", regionId: "unknown", candidateId: "C0" }],
    }),
  ).rejects.toThrow("Unknown");
  expect(renders).toBe(0);
  const preview = prepared.pages[0]!.regions[0]!.candidates[0]!.preview;
  const previewBytes = fs.readFileSync(preview);
  fs.writeFileSync(preview, "tampered");
  await expect(
    render({ workDirectory: work, planId: prepared.planId, expectedRevision: revision }),
  ).rejects.toThrow("preview corrupted");
  fs.writeFileSync(preview, previewBytes);
  const first = await render({
    workDirectory: work,
    planId: (await prepare_text({ workDirectory: work, inputPath, expectedRevision: revision }))
      .planId,
    expectedRevision: revision,
  });
  expect(first.pages.map((page) => page.status)).toEqual([
    "ready",
    "incomplete",
    "incomplete",
    "incomplete",
  ]);
  expect(first.pages.map((page) => page.regions[0]?.blocks[0])).toMatchObject([
    { status: "blank" },
    { status: "failed", reason: "no_fit" },
    { status: "failed", reason: "missing_glyph" },
    { status: "untranslated" },
  ]);
  // 相同内容的草稿修订不使已有计划失效，写操作仍使用当前修订号。
  revision = (
    await apply(work, revision, {
      pages: draft.book.pages,
      records: draft.records,
      confirmed: true,
    })
  ).revision;
  const repeat = await render({
    workDirectory: work,
    planId: prepared.planId,
    expectedRevision: revision,
  });
  expect(repeat).toEqual(first);
  expect(renders).toBe(2);
  const failedCopy = vi.spyOn(default_native_fs, "copy_file").mockImplementationOnce(() => {
    throw new Error("fixture result copy failed");
  });
  await expect(
    render({ workDirectory: work, planId: prepared.planId, expectedRevision: revision }),
  ).rejects.toThrow("result copy failed");
  failedCopy.mockRestore();
  expect(
    fs.readdirSync(path.join(work, "text")).some((entry) => entry.startsWith(".render-")),
  ).toBe(false);
  expect(fs.readdirSync(path.join(work, "text/runs"))).toEqual([first.renderId]);
  fs.rmSync(path.join(work, "text/plans"), { recursive: true });
  const outputDirectory = path.join(temporary.path, "delivery");
  const previewFile = first.pages[0]!.preview!;
  expect(path.relative(path.join(work, "text/runs", first.renderId), previewFile)).toBe(
    path.join("pages", "blank.png"),
  );
  const originalPreview = fs.readFileSync(previewFile);
  fs.writeFileSync(previewFile, "corrupted");
  await expect(
    publish({
      workDirectory: work,
      outputDirectory,
      source: { kind: "rendered", renderId: first.renderId, decisions: [] },
    }),
  ).rejects.toThrow("page missing or corrupted");
  fs.writeFileSync(previewFile, originalPreview);
  await expect(
    publish({
      workDirectory: work,
      outputDirectory,
      source: {
        kind: "rendered",
        renderId: first.renderId,
        decisions: [{ pageId: "text", decision: "accept" }],
      },
    }),
  ).rejects.toThrow("Only ready");
  const delivered = await publish({
    workDirectory: work,
    outputDirectory,
    source: {
      kind: "rendered",
      renderId: first.renderId,
      decisions: [{ pageId: "blank", decision: "accept" }],
    },
  });
  expect(delivered.status).toBe("partial");
  expect(fs.readdirSync(path.join(delivered.path, "pages"))).toEqual(["0001-blank.png"]);
  expect(fs.readdirSync(path.join(delivered.path, "incomplete"))).toHaveLength(3);
  expect(
    (await publish({ workDirectory: work, outputDirectory, source: delivered.source })).path,
  ).toBe(delivered.path);
  fs.writeFileSync(path.join(delivered.path, "incomplete/0002-text/result.json"), "corrupted");
  await expect(
    publish({ workDirectory: work, outputDirectory, source: delivered.source }),
  ).rejects.toThrow("missing or corrupted");
  const unreviewed = await publish({
    workDirectory: work,
    outputDirectory,
    source: { kind: "rendered", renderId: first.renderId, decisions: [] },
  });
  expect(unreviewed.pages.every((page) => page.status === "incomplete")).toBe(true);
  input.records[1]!.text = "B";
  fs.writeFileSync(inputPath, JSON.stringify(input));
  const changed = await render({
    workDirectory: work,
    planId: (await prepare_text({ workDirectory: work, inputPath, expectedRevision: revision }))
      .planId,
    expectedRevision: revision,
  });
  expect(changed.renderId).not.toBe(first.renderId);
  expect(renders).toBe(3);
  expect(changed.pages[0]!.inputSha256).toBe(first.pages[0]!.inputSha256);
  input.records[1]!.text = "C";
  fs.writeFileSync(inputPath, JSON.stringify(input));
  failPage = true;
  const interrupted = await render({
    workDirectory: work,
    planId: (await prepare_text({ workDirectory: work, inputPath, expectedRevision: revision }))
      .planId,
    expectedRevision: revision,
  });
  expect(interrupted.pages[1]).toMatchObject({
    status: "error",
    error: "fixture renderer crashed",
  });
  const recovered = await render({
    workDirectory: work,
    planId: (await prepare_text({ workDirectory: work, inputPath, expectedRevision: revision }))
      .planId,
    expectedRevision: revision,
  });
  expect(recovered.pages[1]!.status).toBe("incomplete");
  expect(renders).toBe(5);
  expect(recovered.pages[0]!.inputSha256).toBe(first.pages[0]!.inputSha256);
  const oldPlan = await prepare_text({
    workDirectory: work,
    inputPath,
    expectedRevision: revision,
  });
  // 同一消字规格重新验收了另一份有效底图，旧译图不能继续代表当前底图发布。
  const current = JSON.parse(fs.readFileSync(path.join(work, "draft.json"), "utf8")) as Draft;
  const ref = current.reviewed!.blank!;
  const oldDirectory = path.join(work, "reviewed/blank", ref.artifactDigest);
  const review = JSON.parse(
    fs.readFileSync(path.join(oldDirectory, "review.json"), "utf8"),
  ) as ReviewRecord;
  review.cleanSha256 = image_sha256(fixture.mask);
  review.artifactDigest = review_artifact_digest(
    "blank",
    review.inputSha256,
    review.cleanSha256,
    review.regions,
  );
  const newDirectory = path.join(work, "reviewed/blank", review.artifactDigest);
  fs.cpSync(oldDirectory, newDirectory, { recursive: true });
  fs.writeFileSync(path.join(newDirectory, "clean.png"), fixture.mask);
  fs.writeFileSync(path.join(newDirectory, "review.json"), JSON.stringify(review));
  ref.artifactDigest = review.artifactDigest;
  fs.writeFileSync(path.join(work, "draft.json"), JSON.stringify(current));
  await expect(
    publish({
      workDirectory: work,
      outputDirectory,
      source: { kind: "rendered", renderId: recovered.renderId, decisions: [] },
    }),
  ).rejects.toThrow("reviewed base");
  await expect(
    render({ workDirectory: work, planId: oldPlan.planId, expectedRevision: revision }),
  ).rejects.toThrow("Stale text plan");
  const newBase = await render({
    workDirectory: work,
    planId: (await prepare_text({ workDirectory: work, inputPath, expectedRevision: revision }))
      .planId,
    expectedRevision: revision,
  });
  expect(newBase.pages[0]!.inputSha256).not.toBe(first.pages[0]!.inputSha256);
  expect(fs.readFileSync(newBase.pages[0]!.preview!)).toEqual(fixture.mask);
  expect(renders).toBe(6);
  const modified = structuredClone(draft.book.pages);
  modified[1]!.regions[0]!.direction = "horizontal-tb";
  revision = (
    await apply(work, revision, { pages: modified, records: draft.records, confirmed: true })
  ).revision;
  await expect(
    prepare_text({ workDirectory: work, inputPath, expectedRevision: revision }),
  ).rejects.toThrow("source mismatch");
});
