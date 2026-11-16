import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { image_fixture } from "../../../test/image-fixture";
import { image_sha256, image_text_source_digest } from "../../file/image/image-format";
import {
  IMAGE_TEXT_RULES,
  type ImageTextHostResult,
  type ImageTextInput,
  type ImageTextPage,
} from "../../../shared/image-text";
import { bind_workspace_requests } from "../workspace/runtime/request-channel";
import { restore } from "./index";
import { publish } from "./publish";
import { render } from "./render";

vi.mock("./engine", () => ({
  pixels: vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === "text_layout") {
      const page = args.page as import("../../../shared/image").ImagePage;
      const distance = Buffer.alloc(4);
      distance.writeFloatLE(10);
      return page.regions
        .filter((region) => region.disposition === "translate")
        .map((region) => ({
          regionId: region.regionId,
          candidates: [
            {
              candidateId: "C0",
              blocks: [
                {
                  blockId: "B1",
                  box: [0, 0, 1, 1],
                  centroid: [0.5, 0.5],
                  distance: distance.toString("base64"),
                },
              ],
            },
          ],
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

it("自动排版结果必须经过视觉接受后才能完整发布", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-publish-"));
  const source = path.join(temporary.path, "source");
  const work = path.join(temporary.path, "work");
  const fixture = image_fixture(["blank", "text"]);
  fs.mkdirSync(source, { recursive: true });
  for (const [file, value] of [
    ["image.json", fixture.book],
    ["items.json", fixture.records],
    ["clean.json", fixture.clean],
  ] as const)
    fs.writeFileSync(path.join(source, file), JSON.stringify(value));
  for (const page of fixture.book.pages) {
    for (const [file, bytes] of [
      [page.original, fixture.original],
      [`clean/${page.pageId}.png`, fixture.original],
      [page.regions[0]!.layoutArea!.path, fixture.mask],
      [
        fixture.clean.pages.find((item) => item.pageId === page.pageId)!.regions[0]!.eraseMask!,
        fixture.mask,
      ],
    ] as const) {
      const target = path.join(source, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
  }
  const draft = await restore(source, work);
  const input: ImageTextInput = {
    bookId: draft.book.bookId,
    sourceSha256: image_text_source_digest(draft.book, draft.records),
    records: draft.records.map((record, index) => ({
      pageId: record.pageId,
      regionId: record.regionId,
      text: index === 0 ? "" : "译",
    })),
  };
  const inputPath = path.join(temporary.path, "input.json");
  fs.writeFileSync(inputPath, JSON.stringify(input));
  const fontsDirectory = path.resolve("public/fonts");
  vi.stubGlobal("ws", { fontsDirectory });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const environment = {
    fontSha256: image_sha256(fs.readFileSync(path.join(fontsDirectory, IMAGE_TEXT_RULES.fontFile))),
    rendererSha256: "a".repeat(64),
    chromium: "fixture",
    platform: process.platform,
    arch: process.arch,
    raster: "chromium-native-dpr1" as const,
  };
  let response = 0;
  bind_workspace_requests({
    call: async (request) => {
      if (request.kind !== "render_image_text_page") throw new Error("Unexpected request");
      const page = request.inputPath
        ? (JSON.parse(fs.readFileSync(request.inputPath, "utf8")) as ImageTextPage)
        : null;
      const result: ImageTextHostResult = {
        environment,
        regions:
          page?.regions.flatMap((region) => {
            const block = region.candidates[0]!.blocks[0]!;
            return [
              {
                result: {
                  regionId: region.regionId,
                  candidateId: "C0",
                  blockId: block.blockId,
                  text: region.text,
                  box: block.box,
                  status: "rendered" as const,
                  fontSize: 2,
                  strokeWidth: 0.5,
                  margin: 2,
                  bounds: [0, 0, 1, 1] as [number, number, number, number],
                  centerError: 0,
                  warnings: [] as [],
                },
                png: "fixture",
              },
            ];
          }) ?? [],
      };
      const file = path.join(temporary.path, `response-${response++}.json`);
      fs.writeFileSync(file, JSON.stringify(result));
      return { path: file };
    },
  });
  await expect(render({ workDirectory: work, inputPath, expectedRevision: 1 })).rejects.toThrow(
    "Stale",
  );
  const rendered = await render({ workDirectory: work, inputPath, expectedRevision: 0 });
  expect(rendered.pages.map((page) => page.status)).toEqual(["rendered", "rendered"]);
  const outputDirectory = path.join(temporary.path, "delivery");
  const partial = await publish({
    workDirectory: work,
    outputDirectory,
    source: {
      kind: "rendered",
      renderId: rendered.renderId,
      decisions: [{ pageId: "blank", decision: "accept" }],
    },
  });
  expect(partial.status).toBe("partial");
  const complete = await publish({
    workDirectory: work,
    outputDirectory,
    source: {
      kind: "rendered",
      renderId: rendered.renderId,
      decisions: [
        { pageId: "blank", decision: "accept" },
        { pageId: "text", decision: "accept" },
      ],
    },
  });
  expect(complete.status).toBe("complete");
});
