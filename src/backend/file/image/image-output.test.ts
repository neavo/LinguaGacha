import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
import { image_fixture } from "../../../test/image-fixture";
import type { ImageTextPage, ImageTextPaint } from "../../../shared/image-text";
import { ImageOutputService } from "./image-output";

it("图片警告继续写出，错误区域回退原图，EXCLUDED 不依赖消字结果", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-output-"));
  const fixture = image_fixture(["warning", "error", "excluded", "page-failure"]);
  fixture.clean.pages[2]!.regions = [{ regionId: "text", status: "failed" }];
  const fallbackRequests: string[][] = [];
  const qaPages: string[] = [];
  const layoutPages: string[] = [];
  const distance = Buffer.alloc(4);
  distance.writeFloatLE(1);
  const service = new ImageOutputService(
    async (operation) => {
      const page = operation.page;
      if (page?.pageId === "page-failure") throw new Error("fixture page failure");
      return page.regions.map((region) => {
        const block = region.candidates[0]!.blocks[0]!;
        const failed = page.pageId === "error";
        return {
          result: failed
            ? {
                regionId: region.regionId,
                renderStatus: "failure" as const,
                reason: "layout_no_fit" as const,
              }
            : {
                regionId: region.regionId,
                box: block.box,
                renderStatus: "warning" as const,
                reasons: ["tight_margin"] as ["tight_margin"],
              },
          ...(failed ? {} : { png: "fixture" }),
        };
      }) satisfies ImageTextPaint[];
    },
    async (command, input) => {
      if (command === "text_layout") {
        const page = input.page as ImageTextPage;
        layoutPages.push(page.pageId);
        return page.regions.map((region) => ({
          regionId: region.regionId,
          candidates: [
            {
              candidateId: "C0",
              blocks: [
                {
                  blockId: "B1",
                  box: [0, 0, 1, 1],
                  distance: distance.toString("base64"),
                  centroid: [0.5, 0.5],
                },
              ],
            },
          ],
        }));
      }
      if (command === "text_compose") fallbackRequests.push(input.fallbackRegionIds as string[]);
      if (command === "qa_preview") qaPages.push((input.page as ImageTextPage).pageId);
      const output = String(input.output);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(String(input.source), output);
      return {};
    },
  );
  const [asset] = await service.write_assets({
    assetPaths: ["comic/chapter.image"],
    items: fixture.records.map((record, row) =>
      create_item({
        src: record.message,
        dst: "译文",
        row,
        file_path: "comic/chapter.image",
        file_type: "IMAGE",
        status: record.pageId === "excluded" ? "EXCLUDED" : "PROCESSED",
      }),
    ),
    readAsset: async () => fixture.pack(),
    outputRoot: temporary.path,
    claimedPaths: new Set(),
    qa: true,
  });

  expect(asset!.files).toMatchObject([
    {
      path: "comic/chapter/warning.png",
      entries: [
        {
          regionId: "text",
          status: "warning",
          output: "translated",
          reasons: [{ code: "tight_margin" }],
        },
      ],
    },
    {
      path: "comic/chapter/error.png",
      entries: [
        {
          regionId: "text",
          status: "failure",
          output: "original",
          reasons: [{ code: "layout_no_fit" }],
        },
      ],
    },
    {
      path: "comic/chapter/excluded.png",
      entries: [{ regionId: "text", status: "success", output: "original", reasons: [] }],
    },
    {
      path: "comic/chapter/page-failure.png",
      entries: [
        {
          status: "failure",
          output: "original",
          reasons: [{ code: "page_output_failed", detail: "fixture page failure" }],
        },
      ],
    },
  ]);
  expect(fallbackRequests).toEqual([[], ["text"], ["text"]]);
  expect(layoutPages).toEqual(["warning", "error", "page-failure"]);
  expect(qaPages).toEqual(["warning", "error", "excluded"]);
  expect(fs.existsSync(path.join(temporary.path, "comic/chapter/warning.png"))).toBe(true);
  expect(fs.existsSync(path.join(temporary.path, "comic/chapter/error.png"))).toBe(true);
  expect(fs.existsSync(path.join(temporary.path, "comic/chapter/excluded.png"))).toBe(true);
  expect(fs.existsSync(path.join(temporary.path, "comic/chapter/page-failure.png"))).toBe(true);
});
