import JSZip from "jszip";
import { expect, it } from "vitest";
import { read_zip_members } from "./zip-members";

it("清单包含全部成员及原始字节，不要求成员可解析或有翻译条目", async () => {
  const zip = new JSZip();
  const bytes = new Uint8Array([0, 128, 255, 254, 65, 0]);
  zip.file("data/Broken.json", "{", { createFolders: false });
  zip.file("data/Empty.json", "[]", { createFolders: false });
  zip.file("binary", bytes, { createFolders: false });
  const files = await read_zip_members(await zip.generateAsync({ type: "uint8array" }), "game.zip");
  expect([...files.keys()]).toEqual(["data/Broken.json", "data/Empty.json", "binary"]);
  expect((await files.get("binary")!.async("nodebuffer")).equals(bytes)).toBe(true);
});

it.each([
  ["data", "data/Actors.json"],
  ["Data", "data/empty/"],
  ["data/Actors.json", "data/actors.json"],
  ["data/Actors.json", "data/Actors.json/"],
  ["../escape.json", "good.json"],
  ["data/../escape.json", "good.json"],
  ["/absolute.json", "good.json"],
  ["C:/absolute.json", "good.json"],
  ["data/Actors.json.", "good.json"],
])("拒绝非法成员集合 %j", async (...names) => {
  const zip = new JSZip();
  for (const name of names) zip.file(name, "{}", { createFolders: false });
  await expect(
    read_zip_members(await zip.generateAsync({ type: "uint8array" }), "game.zip"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});

it("ZIP 同名记录使用最后一个载荷", async () => {
  const zip = new JSZip().file("a.txt", "first").file("b.txt", "second");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  for (
    let offset = bytes.indexOf("b.txt");
    offset >= 0;
    offset = bytes.indexOf("b.txt", offset + 1)
  )
    bytes.write("a.txt", offset); // 同时修改本地文件头和中央目录，不改变记录长度。
  const members = await read_zip_members(bytes, "book.epub");
  expect([...members.keys()]).toEqual(["a.txt"]);
  expect(await members.get("a.txt")!.async("string")).toBe("second");
});
