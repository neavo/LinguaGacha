import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { rgss_archive_fixture } from "../../../test/rgss-archive-fixture";
import { read_rgss_archive, extract_rgss_member } from "./archive";

it.each([1, 3] as const)("v%s 按成员读取，跨分块解密并保留 Unicode 文件名", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-archive-"));
  const native = new NativeFs();
  const files = new Map([
    ["Data\\System.rvdata2", Buffer.from([4, 8, 48])],
    ["Graphics/人物.png", Buffer.from(Array.from({ length: 131079 }, (_, i) => i % 251))],
    ["empty", Buffer.alloc(0)],
  ]);
  const file = path.join(temp.path, "archive");
  fs.writeFileSync(file, rgss_archive_fixture(version, files));
  const handle = await native.open_file(file, "r");
  try {
    const members = await read_rgss_archive(handle);
    expect(members.map((member) => member.name)).toEqual(
      [...files.keys()].map((name) => name.replaceAll("\\", "/")),
    );
    for (const [index, content] of [...files.values()].entries()) {
      const output = path.join(temp.path, "out", members[index]!.name);
      await extract_rgss_member(handle, members[index]!, output, native);
      expect(fs.readFileSync(output)).toEqual(content);
    }
  } finally {
    await handle.close();
  }
});

it.each([1, 3] as const)("v%s 拒绝截断、路径越界、大小写重复和文件目录重叠", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-invalid-"));
  const invalid = [
    rgss_archive_fixture(version, new Map([["ok", Buffer.from("content")]])).subarray(0, -1),
    ...[["../escape"], ["/absolute"], ["NUL.txt"], ["Data/A", "data/a"], ["Data", "Data/A"]].map(
      (names) =>
        rgss_archive_fixture(version, new Map(names.map((name) => [name, Buffer.from("x")]))),
    ),
  ];
  if (version === 3) {
    const archive = rgss_archive_fixture(
      3,
      new Map([
        ["a", Buffer.from("data")],
        ["b", Buffer.from("data")],
      ]),
    );
    const key = (archive.readUInt32LE(8) * 9 + 3) >>> 0;
    for (const offset of [12, (archive.readUInt32LE(12) ^ key) >>> 0]) {
      const overlap = Buffer.from(archive);
      overlap.writeUInt32LE((offset ^ key) >>> 0, 29); // 第二项分别指向目录或第一项内容。
      invalid.push(overlap);
    }
  }
  for (const content of invalid) {
    const file = path.join(temp.path, "archive");
    fs.writeFileSync(file, content);
    const handle = await new NativeFs().open_file(file, "r");
    try {
      await expect(read_rgss_archive(handle)).rejects.toThrow();
    } finally {
      await handle.close();
    }
  }
});
