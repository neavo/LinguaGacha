import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
import { image_fixture } from "../../../test/image-fixture";
import { check_image_helper_request, type ImagePixelHost } from "../../../shared/image-helper";
import { ImageFormat } from "./image-format";
import { ImageOutputService } from "./image-output";

it.each([false, true])("图片生成按区域裁决，只展开本页所需成员（QA=%s）", async (qa) => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-output-"));
  const fixture = image_fixture([
    "translated",
    "no-fit",
    "excluded",
    "blank",
    "unfinished",
    "erase-failed",
    "cover",
  ]);
  fixture.book.pages.find(({ pageId }) => pageId === "erase-failed")!.regions[0]!.patch = null;
  fixture.book.pages.at(-1)!.regions = [];
  fixture.records.pop();

  const processed: (string | undefined)[] = [];
  const service = new ImageOutputService(
    async ({ page }) => {
      expect(["translated", "no-fit"]).toContain(page.pageId);
      return page.regions.map(({ regionId }) => ({
        regionId,
        png: page.pageId === "no-fit" ? null : "fixture",
      }));
    },
    (async (command: string, input: unknown) => {
      if (command !== "text_output" || !check_image_helper_request(command, input))
        throw new Error(`Unexpected command: ${command}`);
      const page = path.basename(input.output).split(".")[0];
      processed.push(page);
      const layers = input.layers ? JSON.parse(fs.readFileSync(input.layers, "utf8")) : [];
      expect(layers).toEqual(
        page === "translated"
          ? [
              {
                patch: fixture.book.pages[0]!.regions[0]!.patch,
                overlay: { box: [0, 0, 1, 1], png: "fixture" },
              },
            ]
          : page === "blank"
            ? [{ patch: fixture.book.pages[3]!.regions[0]!.patch }]
            : [],
      );
      expect(fs.existsSync(path.join(input.root, "patches"))).toBe(layers.length > 0);
      expect(input.qa?.marks).toEqual(
        qa
          ? ["erase-failed", "no-fit", "unfinished"].includes(page!)
            ? [
                {
                  regionId: "text",
                  box: [0, 0, 1, 1],
                  warning: page === "unfinished",
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
    [["original", "erase_failed"]],
    [],
  ]);
  expect(fs.readdirSync(temporary.path)).toEqual(["comic"]);
  if (!qa) {
    expect(processed).toEqual(["translated", "blank"]);
    for (const page of ["excluded", "erase-failed"]) {
      const unchanged = fs.readFileSync(path.join(temporary.path, "comic/chapter", page + ".png"));
      expect(unchanged).toEqual(fixture.original);
    }
  }
});

it("图片 helper 内部错误终止输出", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-output-error-"));
  const fixture = image_fixture(["page"]);
  const service = new ImageOutputService(
    async ({ page }) => page.regions.map(({ regionId }) => ({ regionId, png: "fixture" })),
    async (command) => {
      if (command === "text_output") throw new Error("helper protocol failed");
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

it("同一画像在整泡与分格之间切换并复用补丁，冲突时保留原图", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-variants-"));
  const fixture = image_fixture(["page"]);
  const page = fixture.book.pages[0]!;
  const [first] = page.regions;
  page.regions.push(
    {
      ...first!,
      regionId: "second",
      patch: { path: "patches/page/second.png", box: [0, 0, 1, 1] },
    },
    { ...first!, regionId: "whole", patch: null, parts: ["text", "second"] },
    {
      ...first!,
      kind: "unframed",
      regionId: "outside",
      patch: { path: "patches/page/outside.png", box: [0, 0, 1, 1] },
    },
  );
  fixture.records.push(
    { pageId: "page", regionId: "second", message: "次の台詞" },
    { pageId: "page", regionId: "whole", message: "うん\\n次の台詞" },
    { pageId: "page", regionId: "outside", message: "欄外" },
  );
  const bytes = await fixture.pack();
  const { items } = await new ImageFormat().read(bytes, "book.image");
  expect(items.map(({ status }) => status)).toEqual(["NONE", "NONE", "EXCLUDED", "EXCLUDED"]);

  const paint: string[] = [];
  const pixels: string[] = [];
  const service = new ImageOutputService(
    async ({ page: { regions } }) =>
      regions.map(({ regionId }) => {
        paint.push(regionId);
        return { regionId, png: "fixture" };
      }),
    (async (command: string, input: unknown) => {
      if (command !== "text_output" || !check_image_helper_request(command, input))
        throw new Error("Unexpected pixel request");
      const layers = JSON.parse(fs.readFileSync(input.layers!, "utf8")) as {
        patch: { path: string };
        overlay?: { png: string };
      }[];
      pixels.push(...layers.map(({ patch }) => patch.path));
      expect(layers.filter(({ overlay }) => overlay)).toHaveLength(paint.length);
      return { path: input.output };
    }) as ImagePixelHost,
  );
  const generate = async (directory: string, active: number[]) => {
    paint.length = pixels.length = 0;
    const [asset] = await service.write_assets({
      assetPaths: ["book.image"],
      items: items.map((item, index) => ({
        ...item,
        status: active.includes(index) ? "PROCESSED" : "EXCLUDED",
        dst: "译文",
      })),
      readAsset: () => bytes,
      outputRoot: path.join(temporary.path, directory),
      claimedPaths: new Set(),
    });
    return asset!.files[0]!.entries;
  };
  const split = await generate("split", [0]);
  expect(paint).toEqual(["text"]);
  expect(pixels).toEqual(["patches/page/text.png"]);
  expect(split.map(({ region_id, output }) => [region_id, output])).toEqual([
    ["text", "translated"],
    ["second", "original"],
    ["outside", "original"],
  ]);

  const whole = await generate("whole", [2, 3]);
  expect(paint).toEqual(["whole", "outside"]);
  expect(pixels).toEqual([
    "patches/page/text.png",
    "patches/page/second.png",
    "patches/page/outside.png",
  ]);
  expect(whole.every(({ output }) => output === "translated")).toBe(true);

  expect(await generate("conflict", [0, 2])).toContainEqual({
    region_id: "whole",
    status: "success",
    output: "original",
    reasons: [],
  });
  expect(paint).toEqual([]);
  expect(pixels).toEqual([]);
});
