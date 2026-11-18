import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, it } from "vitest";

import { unpack } from "../../agent/generic/package";
import { image_fixture, patch_fixture } from "../../../test/image-fixture";
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
  archive.remove("patches/page/text.png");
  archive.file("extra.png", fixture.patch);
  await expect(
    read_image_package(await archive.generateAsync({ type: "uint8array" }), "bad.image"),
  ).rejects.toMatchObject({
    cause: {
      message: expect.stringMatching(/missing 1.*patches\/page\/text\.png.*extra 1.*extra\.png/u),
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

it.each(["box", "patch"] as const)("拒绝超出页面的 %s", async (kind) => {
  const fixture = image_fixture(["page"]);
  const region = fixture.book.pages[0]!.regions[0]!;
  const box = kind === "box" ? region.box : region.patch!.box;
  box[0] = 1;
  await expect(read_image_package(await fixture.pack(), "bad.image")).rejects.toThrow(
    "Image region bounds exceed page",
  );
});

it.each([
  [patch_fixture([128]), "alpha must be binary"],
  [patch_fixture([255, 0]), "matching its box"],
])("拒绝补丁像素或尺寸不符的归档", async (invalid, reason) => {
  const archive = await JSZip.loadAsync(await image_fixture(["page"]).pack());
  archive.file("patches/page/text.png", invalid);
  await expect(
    read_image_package(await archive.generateAsync({ type: "uint8array" }), "bad.image"),
  ).rejects.toThrow(reason);
});
