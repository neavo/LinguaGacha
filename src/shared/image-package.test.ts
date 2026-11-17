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

it("每个 OCR 有效文字框必须唯一归属区域", () => {
  const { book, records } = image_fixture(["p1"]);
  book.pages[0]!.regions = [];
  records.length = 0;
  expect(() => read_image_book(book, records)).toThrow("must belong to one region");
});
