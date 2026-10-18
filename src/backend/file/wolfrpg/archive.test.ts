import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { read_wolf_archive } from "./archive";
import { wolf_archive_fixture } from "../../../test/wolf-archive-fixture";
import { wolf_crypt_vectors } from "../../../test/wolf-crypt-vectors";
import { wolf_vector } from "../../../test/wolf-crypt-fixture";
import { BINARY_IO_CHUNK_BYTES } from "../shared/binary";

// 测试自有内容由 UberWolf v0.6.4 的 v2.225 打包器生成，协议参考 f4191375，固定字节独立于夹具编码器。
const LEGACY_ARCHIVE_VECTOR =
  "c4ngYNjAyMDgwAABNowQOgDKL4DylzBDaB4GVLDxx1unp0Iyi37dRKcEOb/r9zDBeBbbeAIiHX+9PR1rVfwifgeSygz/PduUoFRA8Q9/kODlF3479mAxU0imI6D8RSpC8EPxS/9NMunr14hvFdrG8evSC1cMt3wofnR6xxyshmGhJLZxBpSKb3L35AhIfoGuZOOW0uM3787yVp1qUntYSMaDQZqbKyDvR1XXGfGX20Oi/7lrLplX4vnz4iV+nfef2M3bvWqYDXx/6z/efu9TZd6F83xRG42/XzgrPX95ztI1YQvEPuQsV761y/lDznKmvdHTLhoYfT/PF/bBVURr8mquUrlP7u+CLrdV5mn2z1b74Pu7ddaxH9OuLu/tCxVfkMP0tVricEPO8tYn8wo8X169xK/PlSqzfNnk2Wof/ORal0xjvGoAVan0/Vhk+Zqf19tBRudt8pvBF/bDuum26wtmTetWu6gKkAMhRit9nXUu7EPOcl7N1GMfcpa3g925vP18t8rSNcvB2nNgSiA8OAXyZs7SSWyREEGQW9ZfeBUEV/Ly6iX2BQaeOatNClISrLcfXnTMXaX6WkCX4SbzcOnj69mW5ckpz12yJubIWa6Af5MmHzle5xu99lGq0LqCsoeNfO+Ub7i+cKyZL/Y6ztk/lvVayUk5h49H2CvLJlwteRNh0LtK3bhL1TGs6MPmuUef/JK/VHEvM+2qx57b1jv/VSvsYjzfmP1t07LOW43LAQ==";

it("DXArchive 8 crypt=0 的 v2.225 独立向量可读取", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-legacy-vector-"));
  const filename = path.join(temp.path, "Legacy.wolf");
  fs.writeFileSync(filename, wolf_vector(LEGACY_ARCHIVE_VECTOR));
  const expected = new Map([
    ["日本語/確認.txt", Buffer.from("WOLF v2.225 独立向量")],
    ["empty.bin", Buffer.alloc(0)],
  ]);
  const handle = await fs.promises.open(filename, "r");
  try {
    const archive = await read_wolf_archive(handle);
    expect(archive.version).toBe(0);
    expect(archive.members.map((member) => member.name).sort()).toEqual(
      [...expected.keys()].sort(),
    );
    for (const member of archive.members) {
      const chunks: Buffer[] = [];
      for await (const chunk of archive.chunks(member)) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(expected.get(member.name));
    }
  } finally {
    await handle.close();
  }
});

/** 需要配套密钥的 marker 使用独立参考向量中的派生结果。 */
function companion_of(version: number): Buffer | undefined {
  const type = ({ 200: "F1", 1000: "A0", 1010: "A1", 1020: "A2" } as Record<number, string>)[
    version
  ];
  const vector = wolf_crypt_vectors.keys.find((key) => key.type === type);
  return vector ? Buffer.from(vector.key, "hex") : undefined;
}

it.each(["lz", "partial"] as const)(
  "压缩组合 %s 跨 IO 块保留中间区域与首尾流偏移",
  async (compression) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-compressed-block-"));
    const expected = Buffer.alloc(BINARY_IO_CHUNK_BYTES + 31).fill(
      Buffer.from(Array.from({ length: 251 }, (_, i) => i)),
    );
    const source = path.join(temp.path, "Data.wolf");
    fs.writeFileSync(
      source,
      await wolf_archive_fixture(new Map([["large.bin", expected]]), 350, { compression }),
    );
    const handle = await fs.promises.open(source, "r");
    try {
      const archive = await read_wolf_archive(handle);
      const parts: Buffer[] = [];
      for await (const bytes of archive.chunks(archive.members[0]!)) parts.push(bytes);
      expect(Buffer.concat(parts).equals(expected)).toBe(true);
    } finally {
      await handle.close();
    }
  },
);

it.each([100, 200, 1000, 1010, 1020])(
  "新增 marker %i 的目录、成员及分块流可读取",
  async (version) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-new-archive-"));
    const companion = companion_of(version);
    const files = new Map([
      [
        "nested/file.bin",
        Buffer.alloc(BINARY_IO_CHUNK_BYTES + 17).fill(
          Buffer.from(Array.from({ length: 251 }, (_, i) => i)),
        ),
      ],
      ["empty.bin", Buffer.alloc(0)],
    ]);
    const filename = path.join(temp.path, "archive");
    fs.writeFileSync(
      filename,
      await wolf_archive_fixture(files, version, companion ? { companion } : {}),
    );
    const handle = await fs.promises.open(filename, "r");
    try {
      const archive = await read_wolf_archive(handle, undefined, async () => companion!);
      expect(archive.version).toBe(version);
      for (const member of archive.members) {
        const chunks = [];
        for await (const chunk of archive.chunks(member)) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(files.get(member.name));
      }
      if (companion)
        await expect(
          read_wolf_archive(handle, undefined, async () => Buffer.alloc(companion.length, 23)),
        ).rejects.toThrow();
    } finally {
      await handle.close();
    }
  },
);

it.each([0, 300, 314, 331, 350])(
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
it.each([331, 350, 1010, 1020])("小归档 %i 的前缀与目录重叠及空归档", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-small-"));
  const companion = companion_of(version);
  for (const files of [new Map<string, Buffer>(), new Map([["a", Buffer.from("x")]])]) {
    const filename = path.join(temp.path, "Data.wolf");
    fs.writeFileSync(
      filename,
      await wolf_archive_fixture(files, version, companion ? { companion } : {}),
    );
    const handle = await fs.promises.open(filename, "r");
    try {
      const archive = await read_wolf_archive(handle, undefined, async () => companion!);
      expect(archive.members).toHaveLength(files.size);
      for (const member of archive.members) {
        const chunks = [];
        for await (const chunk of archive.chunks(member)) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(files.get(member.name));
      }
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
