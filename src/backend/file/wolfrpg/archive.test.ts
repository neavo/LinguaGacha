import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { read_wolf_archive } from "./archive";
import { wolf_archive_fixture } from "../../../test/wolf-archive-fixture";

it.each([300, 314, 331, 350])(
  "归档 %i 支持嵌套日文、零字节、空目录和不同压缩组合",
  async (version) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-archive-"));
    const files = new Map([
      ["日本語/確認.txt", Buffer.from("繰り返す原文".repeat(900))],
      ["empty.bin", Buffer.alloc(0)],
      ["short.bin", Buffer.from([1, 2, 3])],
    ]);
    for (const compression of [undefined, "lz", "huffman", "both", "partial"] as const) {
      const filename = path.join(temp.path, "Data.wolf");
      fs.writeFileSync(
        filename,
        await wolf_archive_fixture(files, version, {
          ...(compression ? { compression } : {}),
          empty_directory: true,
        }),
      );
      const handle = await fs.promises.open(filename, "r");
      try {
        const archive = await read_wolf_archive(handle);
        expect(archive.version).toBe(version);
        expect(archive.members).toHaveLength(files.size);
        expect(archive.directories.toSorted()).toEqual(["Empty", "日本語"]);
        for (const member of archive.members) {
          const parts: Buffer[] = [];
          for await (const chunk of archive.chunks(member)) parts.push(chunk);
          expect(Buffer.concat(parts)).toEqual(files.get(member.name));
        }
      } finally {
        await handle.close();
      }
    }
  },
);
it.each([331, 350])("小归档 %i 的前缀与目录重叠及空归档", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-small-"));
  for (const files of [new Map<string, Buffer>(), new Map([["a", Buffer.from("x")]])]) {
    const filename = path.join(temp.path, "Data.wolf");
    fs.writeFileSync(filename, await wolf_archive_fixture(files, version));
    const handle = await fs.promises.open(filename, "r");
    try {
      expect((await read_wolf_archive(handle)).members).toHaveLength(files.size);
    } finally {
      await handle.close();
    }
  }
});
it("损坏目录的越界、循环、重复目标和路径穿越在展开前拒绝", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-invalid-"));
  const valid = await wolf_archive_fixture(
    new Map([
      ["a/file", Buffer.from("x")],
      ["b", Buffer.from("y")],
    ]),
    300,
    { clear: true },
  );
  const directory = Number(valid.readBigUInt64LE(16)),
    table = directory + Number(valid.readBigUInt64LE(24));
  const changes: Array<(bytes: Buffer) => Buffer> = [
    (b) => b.subarray(0, -1),
    (b) => {
      b.writeBigUInt64LE(0xffffffffffffffen, 16);
      return b;
    },
    (b) => {
      b.writeBigUInt64LE(0n, table + 40);
      return b;
    },
    (b) => {
      b.writeBigUInt64LE(b.readBigUInt64LE(table), table + 72);
      return b;
    },
    (b) => {
      b[directory + 8] = 47;
      return b;
    },
  ];
  for (const change of changes) {
    const filename = path.join(temp.path, "Data.wolf");
    fs.writeFileSync(filename, change(Buffer.from(valid)));
    const handle = await fs.promises.open(filename, "r");
    try {
      await expect(read_wolf_archive(handle)).rejects.toThrow();
    } finally {
      await handle.close();
    }
  }
});
