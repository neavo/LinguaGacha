import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, it } from "vitest";

import { unpack } from "../../agent/generic/package";
import { image_fixture, selection_fixture } from "../../../test/image-fixture";
import { write_zip } from "../../../test/zip-fixture";
import { read_image_package, validate_image_package_directory } from "./image-package";

it("工作目录与归档执行同一当前图片物理契约", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-package-"));
  const source = path.join(temporary.path, "source.image");
  const directory = path.join(temporary.path, "package");
  await writeFile(source, await image_fixture(["page"]).pack());
  await unpack(source, directory);

  await expect(validate_image_package_directory(directory)).resolves.toMatchObject({
    book: { pages: [{ pageId: "page" }] },
    records: [{ pageId: "page", message: "うん" }],
  });
});

it("成员不匹配同时报告缺失与多余路径", async () => {
  const fixture = image_fixture(["page"]);
  const archive = await JSZip.loadAsync(await fixture.pack());
  archive.remove("layout-areas/page/text.png");
  archive.file("extra.png", fixture.mask);
  await expect(
    read_image_package(await archive.generateAsync({ type: "uint8array" }), "bad.image"),
  ).rejects.toMatchObject({
    cause: {
      message: expect.stringMatching(
        /missing 1.*layout-areas\/page\/text\.png.*extra 1.*extra\.png/u,
      ),
    },
  });
});

it("超额成员声明在解压前拒绝", async () => {
  const oversized = Buffer.from(await image_fixture(["page1", "page2"]).pack());
  const directory = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); // 定位中央目录首条记录签名。
  oversized.writeUInt32LE(1_000_000_000, directory + 24); // 偏移 +24 为未压缩体积字段。
  await expect(read_image_package(oversized, "oversized.image")).rejects.toMatchObject({
    code: "file.asset_too_large",
  });
});

it("归档拒绝缺少实际掩码的成功消字记录", async () => {
  const fixture = image_fixture(["page"]);
  delete fixture.clean.pages[0]!.regions[0]!.eraseMask;
  await expect(read_image_package(await fixture.pack(), "bad.image")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});

it("实际消字掩码不能超出排版区域", async () => {
  const fixture = image_fixture(["p1"]);
  const page = fixture.book.pages[0]!,
    clean = fixture.clean.pages[0]!;
  const region = page.regions[0]!;
  const original = selection_fixture([0, 30]);
  const output = selection_fixture([255, 30]);
  const selection = selection_fixture([255, 255]);
  const mask = selection_fixture([255, 0]);
  page.width = 2;
  const entries = new Map<string, string | Uint8Array>([
    [page.original, original],
    [clean.clean, output],
    [region.layoutArea.path, selection],
    [clean.regions[0]!.eraseMask!, mask],
    ["items.json", JSON.stringify(fixture.records)],
  ]);
  const archive = async () => {
    entries.set("image.json", JSON.stringify(fixture.book));
    entries.set("clean.json", JSON.stringify(fixture.clean));
    return write_zip(entries);
  };
  await read_image_package(await archive(), "repair.image");
  const outside = selection_fixture([0, 255]);
  entries.set(region.layoutArea.path, outside);
  const bytes = await archive();
  await expect(read_image_package(bytes, "outside.image")).rejects.toThrow(
    "exceeds region layout area",
  );
  await expect(
    read_image_package(bytes, "outside.image", { validatePixels: false }),
  ).resolves.toMatchObject({
    records: fixture.records,
  });
});

it.each(["nonbinary", "empty"])("选区资产拒绝 %s", async (kind) => {
  const f = image_fixture(["p1"]);
  const page = f.book.pages[0]!;
  const region = page.regions[0]!;
  const mask = selection_fixture([kind === "empty" ? 0 : 128]);
  const output = f.original;
  const entries = new Map<string, string | Uint8Array>([
    ["image.json", JSON.stringify(f.book)],
    ["items.json", JSON.stringify(f.records)],
    ["clean.json", JSON.stringify(f.clean)],
    [page.original, f.original],
    [f.clean.pages[0]!.clean, output],
    [region.layoutArea.path, mask],
  ]);
  if (f.clean.pages[0]!.regions[0]!.status === "cleaned")
    entries.set(f.clean.pages[0]!.regions[0]!.eraseMask!, mask);
  await expect(read_image_package(await write_zip(entries), "bad.image")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});

it("语义区域保持独立时允许排版区域重叠", async () => {
  const fixture = image_fixture(["p1"]);
  const page = fixture.book.pages[0]!;
  page.textBoxes.push({ ...structuredClone(page.textBoxes[0]!), textBoxId: "t2" });
  page.regions.push({
    ...structuredClone(page.regions[0]!),
    regionId: "second",
    textBoxIds: ["t2"],
    layoutArea: { ...page.regions[0]!.layoutArea, path: "layout-areas/p1/second.png" },
  });
  fixture.clean.pages[0]!.regions.push({
    ...structuredClone(fixture.clean.pages[0]!.regions[0]!),
    regionId: "second",
    eraseMask: "erase-masks/p1/second.png",
  });
  fixture.records.push({ pageId: "p1", regionId: "second", message: "第二段" });
  expect((await read_image_package(await fixture.pack(), "overlap.image")).book.pages).toHaveLength(
    1,
  );
});
