import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
import { image_fixture } from "../../../test/image-fixture";
import { check_image_helper_request, type ImagePixelHost } from "../../../shared/image-helper";
import { ImageOutputService } from "./image-output";

it.each([false, true])("图片生成按区域裁决，只展开本页所需成员（QA=%s）", async (qa) => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-output-"));
  const fixture = image_fixture([
    "translated",
    "no-fit",
    "excluded",
    "blank",
    "unfinished",
    "cover",
  ]);
  fixture.clean.pages[2]!.regions = [{ regionId: "text", status: "failed" }];
  fixture.book.pages.at(-1)!.textBoxes = [];
  fixture.book.pages.at(-1)!.regions = [];
  fixture.clean.pages.at(-1)!.regions = [];
  fixture.records.pop();

  const service = new ImageOutputService(
    async ({ page }) =>
      page.regions.map(({ regionId }) => ({
        regionId,
        png: page.pageId === "no-fit" ? null : "fixture",
      })),
    (async (command: string, input: unknown) => {
      if (command === "text_layout" && check_image_helper_request(command, input)) {
        return input.page.regions.map(({ regionId, layoutArea }) => {
          expect(fs.existsSync(path.join(input.root, layoutArea.path))).toBe(true);
          return { regionId, box: [0, 0, 1, 1], distance: "", sourceLines: [] };
        });
      }
      if (command !== "text_output" || !check_image_helper_request(command, input))
        throw new Error(`Unexpected command: ${command}`);
      const page = path.basename(input.output).split(".")[0];
      const layers = input.composition
        ? JSON.parse(fs.readFileSync(input.composition.layers, "utf8"))
        : [];
      expect(layers).toEqual(
        page === "translated"
          ? [
              {
                eraseMask: "erase-masks/translated/text.png",
                overlay: { box: [0, 0, 1, 1], png: "fixture" },
              },
            ]
          : page === "blank"
            ? [{ eraseMask: "erase-masks/blank/text.png" }]
            : [],
      );
      expect(fs.existsSync(path.join(input.root, "clean"))).toBe(layers.length > 0);
      expect(input.qa?.marks).toEqual(
        qa
          ? page === "no-fit" || page === "unfinished"
            ? [
                {
                  regionId: "text",
                  layoutArea: `layout-areas/${page}/text.png`,
                  incomplete: page === "unfinished",
                },
              ]
            : []
          : undefined,
      );
      fs.mkdirSync(path.dirname(input.output), { recursive: true });
      fs.copyFileSync(input.original, input.output);
      return { path: input.output };
    }) as ImagePixelHost,
  );
  const [asset] = await service.write_assets({
    assetPaths: ["comic/chapter.image"],
    items: fixture.records.map((record, row) =>
      create_item({
        src: record.message,
        dst: record.pageId === "blank" ? "" : "译文",
        row,
        file_path: "comic/chapter.image",
        file_type: "IMAGE",
        status:
          record.pageId === "excluded"
            ? "EXCLUDED"
            : record.pageId === "unfinished"
              ? "NONE"
              : "PROCESSED",
      }),
    ),
    readAsset: fixture.pack,
    outputRoot: temporary.path,
    claimedPaths: new Set(),
    qa,
  });

  const extension = qa ? ".png.webp" : ".png";
  expect(asset!.files.map(({ path }) => path)).toEqual(
    fixture.book.pages.map(({ pageId }) => `comic/chapter/${pageId}${extension}`),
  );
  expect(
    asset!.files.map(({ entries }) =>
      entries.map(({ output, reasons }) => [output, reasons[0]?.code]),
    ),
  ).toEqual([
    [["translated", undefined]],
    [["original", "layout_no_fit"]],
    [["original", undefined]],
    [["translated", undefined]],
    [["original", "translation_incomplete"]],
    [],
  ]);
  expect(fs.readdirSync(temporary.path)).toEqual(["comic"]);
});

it("图片 helper 内部错误终止输出", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-output-error-"));
  const fixture = image_fixture(["page"]);
  const service = new ImageOutputService(
    async () => [],
    async (command) => {
      if (command === "text_layout") throw new Error("helper protocol failed");
      throw new Error("unexpected command");
    },
  );
  await expect(
    service.write_assets({
      assetPaths: ["comic/chapter.image"],
      items: fixture.records.map((record, row) =>
        create_item({
          src: record.message,
          dst: "译文",
          row,
          file_path: "comic/chapter.image",
          file_type: "IMAGE",
          status: "PROCESSED",
        }),
      ),
      readAsset: async () => fixture.pack(),
      outputRoot: temporary.path,
      claimedPaths: new Set(),
      qa: true,
    }),
  ).rejects.toThrow("helper protocol failed");
});
