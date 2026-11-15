import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { image_fixture } from "../../../test/image-fixture";
import { assert_immutable_pages, ensure_normalized } from "./state";

it("区域编辑可改变方向，但不能删页或替换原图身份", () => {
  const { book } = image_fixture(["first", "second"]);
  const changed = structuredClone(book.pages);
  changed[0]!.regions[0]!.direction = "horizontal-tb";
  expect(() => assert_immutable_pages(book.pages, changed)).not.toThrow();
  expect(() => assert_immutable_pages(book.pages, changed.slice(1))).toThrow("page count");
  changed[0]!.sha256 = "f".repeat(64);
  expect(() => assert_immutable_pages(book.pages, changed)).toThrow("Original identity");
});

it("规范化缓存损坏时从原图重建，原图身份变化时停止处理", async () => {
  using tmp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-state-"));
  const { book, original } = image_fixture(["page"]);
  const source = path.join(tmp.path, book.pages[0]!.original);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, original);
  const target = (await ensure_normalized(tmp.path, book.pages)).get("page")!;
  const normalized = fs.readFileSync(target);
  fs.writeFileSync(target, "broken PNG");
  await ensure_normalized(tmp.path, book.pages);
  expect(fs.readFileSync(target).equals(normalized)).toBe(true);
  fs.appendFileSync(source, "changed source");
  await expect(ensure_normalized(tmp.path, book.pages)).rejects.toThrow(
    "Original image missing or tampered",
  );
  expect(fs.readFileSync(target).equals(normalized)).toBe(true);
});
