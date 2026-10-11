import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { write_agent_workspace_sources } from "./sources";
import JSZip from "jszip";

it("普通原稿按资产相对路径保留原始字节", async () => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-"));
  const bytes = Buffer.from([0, 128, 255, 254, 65, 0]);
  const files = ["TXT", "PDF", "XLSX", "WOLFXLSX"].map((file_type) => ({
    file_path: `资料/文件.${file_type.toLowerCase()}`,
    file_type,
  }));
  await write_agent_workspace_sources({
    nativeFs: new NativeFs(),
    sourceRoot: path.join(root.path, "sources"),
    files,
    readAsset: () => bytes,
  });
  for (const file of files)
    expect(fs.readFileSync(path.join(root.path, "sources", file.file_path))).toEqual(bytes);
});

it.each([
  ["RPGMAKER_MV_MZ", "game.zip.zip"],
  ["EPUB", "小说/书.epub"],
])("%s 按资产相对路径展开并保留所有成员字节", async (file_type, file_path) => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-rm-"));
  const zip = new JSZip();
  const members = new Map([
    ["data/Broken.json", Buffer.from("{")],
    ["data/Empty.json", Buffer.from("[]")],
    ["js/plugins/Test.js", Buffer.from([0, 128, 255, 254, 65, 0])],
  ]);
  for (const [name, bytes] of members) zip.file(name, bytes);
  const content = await zip.generateAsync({ type: "nodebuffer" });
  await write_agent_workspace_sources({
    nativeFs: new NativeFs(),
    sourceRoot: path.join(root.path, "sources"),
    files: [{ file_path, file_type }],
    readAsset: () => content,
  });
  for (const [name, bytes] of members)
    expect(fs.readFileSync(path.join(root.path, "sources", file_path, name))).toEqual(bytes);
});

it.each(["RPGMAKER_MV_MZ", "EPUB"])("%s 拒绝越界容器成员，外部路径没有写入", async (file_type) => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-rm-"));
  const zip = new JSZip().file("../../outside.json", "{}", { createFolders: false });
  const content = await zip.generateAsync({ type: "nodebuffer" });
  await expect(
    write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot: path.join(root.path, "sources"),
      files: [{ file_path: "game.zip", file_type }],
      readAsset: () => content,
    }),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
  expect(fs.existsSync(path.join(root.path, "outside.json"))).toBe(false);
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
  ).rejects.toMatchObject({ code: "request.validation_failed" });
  expect(fs.existsSync(path.join(root.path, "outside.txt"))).toBe(false);
});

it.each([
  ["game", "game/readme.txt"],
  ["game/readme.txt", "game"],
])("路径冲突在任何原稿投影前失败 %j", async (...paths) => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-conflict-"));
  const sourceRoot = path.join(root.path, "sources");
  await expect(
    write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot,
      files: paths.map((file_path) => ({ file_path, file_type: "TXT" })),
      readAsset: () => Buffer.from("原稿"),
    }),
  ).rejects.toMatchObject({ code: "request.validation_failed" });
  expect(fs.existsSync(sourceRoot)).toBe(false);
});
