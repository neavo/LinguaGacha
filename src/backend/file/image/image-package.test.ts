import JSZip from "jszip";
import { expect, it } from "vitest";

import { image_fixture } from "../../../test/image-fixture";
import { read_image_package } from "./image-package";

it("入库要求补丁掩码存在且没有额外文件", async () => {
  const archive = await JSZip.loadAsync(await image_fixture(["page"]).pack());
  const mask = "patch-masks/page/text.png";
  const bytes = await archive.file(mask)!.async("uint8array");
  const read = async () =>
    read_image_package(await archive.generateAsync({ type: "uint8array" }), "book.image");
  archive.remove(mask);
  await expect(read()).rejects.toThrow(mask);
  archive.file(mask, bytes);
  archive.file("extra.png", bytes);
  await expect(read()).rejects.toThrow("extra.png");
});

it("入库读取 AVIF 原图清单，像素解码由工作区负责", async () => {
  const fixture = image_fixture(["page"]);
  Object.assign(fixture.book.pages[0]!, {
    original: "originals/page.avif",
    relativePath: "page.avif",
  });
  await expect(read_image_package(await fixture.pack(), "book.image")).resolves.toEqual({
    book: fixture.book,
    records: fixture.records,
  });
});
