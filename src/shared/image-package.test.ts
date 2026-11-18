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
