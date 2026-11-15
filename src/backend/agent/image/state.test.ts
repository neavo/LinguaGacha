import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { default_native_fs } from "../../../native/native-fs";
import { image_fixture } from "../../../test/image-fixture";
import { assert_immutable_pages, ensure_normalized, commit_directory } from "./state";

it.runIf(process.platform === "win32")(
  "目录提交在临时占用后重试，非临时错误保留待提交内容",
  async () => {
    using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-image-commit-"));
    const stage = path.join(temporary.path, "stage"),
      target = path.join(temporary.path, "target");
    fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, "page.png"), "fixture");
    using rename = vi.spyOn(default_native_fs, "rename").mockImplementationOnce(() => {
      throw Object.assign(new Error("busy"), { code: "EPERM" });
    });
    await commit_directory(stage, target);
    expect(fs.readFileSync(path.join(target, "page.png"), "utf8")).toBe("fixture");
    expect(fs.existsSync(stage)).toBe(false);
    const reason = Object.assign(new Error("bad path"), { code: "ENOENT" });
    rename.mockImplementationOnce(() => {
      throw reason;
    });
    await expect(commit_directory(target, stage)).rejects.toBe(reason);
    expect(fs.readFileSync(path.join(target, "page.png"), "utf8")).toBe("fixture");
  },
);

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
