import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { image_fixture } from "../../../test/image-fixture";
import { ImageFormat } from "../../file/image/image-format";
import { read_image_package_manifest } from "../../file/image/image-package";
import { set_image_bubble_layout, set_image_font_sizes } from "./layout";

it("用同一份图片清单切换导入和出图的区域，并独立保存字号", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-layout-"));
  const fixture = image_fixture(["page"]);
  const page = fixture.book.pages[0]!;
  const first = page.regions[0]!;
  page.regions.push(
    { ...first, regionId: "second", patch: null },
    { ...first, regionId: "whole", parts: [first.regionId, "second"], patch: null },
  );
  fixture.records.push(
    { pageId: page.pageId, regionId: "second", message: "乙" },
    { pageId: page.pageId, regionId: "whole", message: "甲乙" },
  );
  const root = path.join(directory.path, "package");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "image.json"), JSON.stringify(fixture.book));
  fs.writeFileSync(path.join(root, "items.json"), JSON.stringify(fixture.records));

  const format = new ImageFormat();
  const split = await format.read(await fixture.pack(), "book.image");
  expect(split.items.map(({ row, src, status }) => [row, src, status])).toEqual([
    [0, "うん", "NONE"],
    [1, "乙", "NONE"],
  ]);

  expect(
    set_image_bubble_layout(directory.path, { pageId: page.pageId, regionId: "second" }, "whole"),
  ).toEqual({ status: "prepared" });
  set_image_font_sizes(directory.path, [{ pageId: page.pageId, regionId: "whole", fontSize: 18 }]);
  fixture.book.pages = read_image_package_manifest(root).book.pages;
  const bytes = await fixture.pack();
  const { items, image } = await format.read(bytes, "book.image");
  expect(items.map(({ row, src }) => [row, src])).toEqual([[2, "甲乙"]]);
  expect(image.book.pages[0]!.regions[2]!.fontSize).toBe(18);
  const [whole] = items;
  whole!.status = "PROCESSED";
  whole!.dst = "整泡译文";
  expect(JSON.parse(await format.render_text(bytes, items, "book.image"))).toEqual([
    { pageId: "page", regionId: "whole", output: "translated", text: "整泡译文" },
  ]);

  set_image_bubble_layout(directory.path, { pageId: page.pageId, regionId: "whole" }, "split");
  set_image_font_sizes(directory.path, [
    { pageId: page.pageId, regionId: "whole", fontSize: null },
  ]);
  const reverted = read_image_package_manifest(root).book;
  expect(reverted).toEqual(split.image.book);
});
