import { expect, it } from "vitest";

import { image_fixture } from "../test/image-fixture";
import { read_image_book } from "./image-package";

it("图片相对路径拒绝越界与大小写冲突", () => {
  const escaped = image_fixture(["p1"]);
  escaped.book.pages[0]!.relativePath = "../page.png";
  expect(() => read_image_book(escaped.book, escaped.records)).toThrow();

  const duplicated = image_fixture(["p1", "p2"]);
  duplicated.book.pages[0]!.relativePath = "chapter/Page.png";
  duplicated.book.pages[1]!.relativePath = "chapter/page.PNG";
  expect(() => read_image_book(duplicated.book, duplicated.records)).toThrow(
    "Invalid or duplicate image relative path",
  );
});

it("写字区域必须有原文，纯原图页可以没有条目", () => {
  const { book, records } = image_fixture(["p1"]);
  expect(() => read_image_book(book, [])).toThrow("requires non-empty source text");
  book.pages[0]!.regions = [];
  expect(() => read_image_book(book, records)).toThrow("Invalid image record reference");
  expect(read_image_book(book, []).pages).toHaveLength(1);
});

it("补丁必须声明独立掩码，图片包拒绝矢量原图", () => {
  const { book, records } = image_fixture(["page"]);
  const page = book.pages[0]!;
  const region = page.regions[0]!;
  const { path, box } = region.patch!;
  const legacy = { ...book, pages: [{ ...page, regions: [{ ...region, patch: { path, box } }] }] };
  expect(() => read_image_book(legacy, records)).toThrow("Invalid image state");
  region.patch!.mask = "patch-masks/another/text.png";
  expect(() => read_image_book(book, records)).toThrow("Invalid image patch member path");
  region.patch!.mask = "patch-masks/page/text.png";
  page.original = "originals/page.svg";
  expect(() => read_image_book(book, records)).toThrow("Invalid original path");
});

it.each(["box", "patch"] as const)("拒绝超出页面的 %s", (kind) => {
  const { book, records } = image_fixture(["page"]);
  const region = book.pages[0]!.regions[0]!;
  const box = kind === "box" ? region.box : region.patch!.box;
  box[0] = 1;
  expect(() => read_image_book(book, records)).toThrow("Image region bounds exceed page");
});
