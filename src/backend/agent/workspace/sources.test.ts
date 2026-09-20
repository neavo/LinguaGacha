import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { write_agent_workspace_sources } from "./sources";

it("各类原稿按工程顺序和相对路径保留原始字节", async () => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-"));
  const bytes = Buffer.from([0, 128, 255, 254, 65, 0]);
  const files = ["TXT", "PDF", "EPUB", "XLSX"].map((file_type) => ({
    file_path: `资料/文件.${file_type.toLowerCase()}`,
    file_type,
  }));
  expect(
    await write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot: path.join(root.path, "sources"),
      files,
      readAsset: () => bytes,
    }),
  ).toEqual(files);
  for (const file of files)
    expect(fs.readFileSync(path.join(root.path, "sources", file.file_path))).toEqual(bytes);
});
it("拒绝源文件路径逃逸", async () => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-"));
  await expect(
    write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot: path.join(root.path, "sources"),
      files: [{ file_path: "../outside.txt", file_type: "TXT" }],
      readAsset: () => Buffer.from("x"),
    }),
  ).rejects.toThrow("Invalid project source path");
  expect(fs.existsSync(path.join(root.path, "outside.txt"))).toBe(false);
});
