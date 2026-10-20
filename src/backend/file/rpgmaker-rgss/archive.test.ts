import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { rgss_archive_fixture } from "../../../test/rgss-archive-fixture";
import { read_rgss_archive, extract_rgss_member } from "./archive";
import { BINARY_IO_CHUNK_BYTES } from "../shared/binary";

it("IO 块内计算可取消，尚未写出的块丢弃并关闭目标句柄", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-compute-cancel-"));
  const source = path.join(temp.path, "archive"),
    destination = path.join(temp.path, "output");
  fs.writeFileSync(
    source,
    rgss_archive_fixture(3, new Map([["large.bin", Buffer.alloc(BINARY_IO_CHUNK_BYTES + 7, 42)]])),
  );
  const native = new NativeFs(),
    handle = await native.open_file(source, "r");
  try {
    const member = (await read_rgss_archive(handle))[0]!;
    const controller = new AbortController(),
      read = handle.read.bind(handle);
    Object.assign(handle, {
      read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const result = await read(buffer, offset, length, position);
        // 等计算开始后再取消，验证取消检查发生在整块落盘之前。
        setImmediate(() => setImmediate(() => controller.abort(new Error("cancel computation"))));
        return result;
      },
    });
    await expect(
      extract_rgss_member(handle, member, destination, native, controller.signal),
    ).rejects.toThrow("cancel computation");
    expect(fs.statSync(destination).size).toBe(0);
    fs.renameSync(destination, destination + ".closed");
  } finally {
    await handle.close();
  }
});

it.each([1, 3] as const)("v%s 按成员读取，跨分块解密并保留 Unicode 文件名", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-archive-"));
  const native = new NativeFs();
  const files = new Map([
    ["Data\\System.rvdata2", Buffer.from([4, 8, 48])],
    [
      "Graphics/人物.png",
      Buffer.alloc(BINARY_IO_CHUNK_BYTES + 7).fill(
        Buffer.from(Array.from({ length: 251 }, (_, i) => i)),
      ),
    ],
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
      expect(fs.readFileSync(output).equals(content), members[index]!.name).toBe(true);
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
