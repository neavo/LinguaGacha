import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { extract_asar_member, read_asar, read_asar_member } from "./asar";

/** 按 ASAR 格式写出索引与数据区，索引内容由测试直接给出以构造异常成员。 */
function write_asar(file: string, files: Record<string, unknown>, data: string): void {
  const json = Buffer.from(JSON.stringify({ files }));
  const header = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  header.writeUInt32LE(header.length - 4, 0);
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(header.length, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([size, header, Buffer.from(data)]));
}
const file = (offset: number, size: number) => ({ offset: String(offset), size }); // ASAR 索引用字符串保存偏移。

it("包内文件、归档旁文件与包内链接按清单读取和物化", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-asar-"));
  const native = new NativeFs();
  const archive = path.join(temp.path, "app.asar");
  write_asar(
    archive,
    {
      data: { files: { "a.ks": file(0, 3), "alias.ks": { link: "data/a.ks" } } },
      "big.bin": { size: 4, unpacked: true },
    },
    "abc",
  );
  native.write_file_sync(path.join(archive + ".unpacked", "big.bin"), "wxyz");
  const members = read_asar(archive, native);
  expect([...members.keys()].sort()).toEqual(["big.bin", "data/a.ks", "data/alias.ks"]);
  const handle = await native.open_file(archive, "r");
  try {
    expect(
      (await read_asar_member(handle, archive, members.get("data/alias.ks")!, native)).toString(),
    ).toBe("abc");
    for (const name of members.keys())
      await extract_asar_member(
        handle,
        archive,
        members.get(name)!,
        path.join(temp.path, "out", name),
        native,
      );
  } finally {
    await handle.close();
  }
  expect(native.read_text_file(path.join(temp.path, "out/data/alias.ks"))).toBe("abc");
  expect(native.read_text_file(path.join(temp.path, "out/big.bin"))).toBe("wxyz");
  native.write_file_sync(path.join(archive + ".unpacked", "big.bin"), "short");
  const again = await native.open_file(archive, "r");
  try {
    await expect(read_asar_member(again, archive, members.get("big.bin")!, native)).rejects.toThrow(
      /size mismatch/u,
    );
  } finally {
    await again.close();
  }
});

it.each([
  [{ a: { link: "../outside" } }, /outside archive/u],
  [{ a: { link: "missing" } }, /missing or a directory/u],
  [{ a: { link: "dir" }, dir: { files: {} } }, /missing or a directory/u],
  [{ a: { link: "b" }, b: { link: "a" } }, /cycle/u],
  [{ a: file(0, 10) }, /outside archive data/u],
  [{ A: file(0, 1), a: file(1, 1) }, /differs only by case/u],
])("拒绝越界、悬空、目录、循环链接与损坏边界：%j", (files, error) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-asar-bad-"));
  const archive = path.join(temp.path, "app.asar");
  write_asar(archive, files, "ab");
  expect(() => read_asar(archive, new NativeFs())).toThrow(error);
});
