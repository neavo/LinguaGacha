import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { evb_fixture } from "../../../../test/evb-fixture";
import { read_evb, extract_evb_member } from "./archive";
import { BINARY_IO_CHUNK_BYTES } from "../binary";

it("非 EVB 的 PE 节布局留给后续引擎识别，EVB 标志仍触发完整校验", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-evb-identity-"));
  const bytes = evb_fixture(new Map([["data/System.json", Buffer.from("{}")]]));
  const marker = bytes.indexOf(Buffer.from(".enigma1"));
  expect(marker).toBeGreaterThan(0);
  bytes.writeUInt32LE(0xffffffff, marker + 16);
  const source = path.join(temp.path, "game.exe"),
    native = new NativeFs();
  fs.writeFileSync(source, bytes);
  const invalid = await native.open_file(source, "r");
  try {
    await expect(read_evb(invalid)).rejects.toThrow("Truncated PE section");
  } finally {
    await invalid.close();
  }
  Buffer.from("pck\0\0\0\0\0").copy(bytes, marker);
  fs.writeFileSync(source, bytes);
  const other = await native.open_file(source, "r");
  try {
    expect(await read_evb(other)).toBeNull();
  } finally {
    await other.close();
  }
});

it.each(["7_80", "10_70"] as const)("EVB %s 的目录和载荷跨读取窗口保持完整", async (variant) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-evb-window-"));
  const files = new Map(
    Array.from({ length: 6000 }, (_, i): [string, Buffer] => [
      `${String(i).padStart(4, "0")}-${"name".repeat(16)}`,
      Buffer.from("x"),
    ]),
  );
  files.set(
    "large.bin",
    Buffer.alloc(BINARY_IO_CHUNK_BYTES + 17).fill(
      Buffer.from(Array.from({ length: 251 }, (_, i) => i)),
    ),
  );
  const source = path.join(temp.path, "packed.exe");
  fs.writeFileSync(source, evb_fixture(files, false, variant));
  const native = new NativeFs(),
    handle = await native.open_file(source, "r");
  try {
    const archive = (await read_evb(handle))!;
    expect(archive.members.map((member) => member.name)).toEqual([...files.keys()]);
    const output = path.join(temp.path, "large.bin");
    await extract_evb_member(handle, archive.members.at(-1)!, output, native);
    expect(fs.readFileSync(output).equals(files.get("large.bin")!)).toBe(true);
  } finally {
    await handle.close();
  }
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])("EVB 架构 %s 旧布局 %s 提取保留原始载荷", async (x64, legacy) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-evb-"));
  const files = new Map([
    ["www/data/System.json", Buffer.from('{"gameTitle":"原稿"}')],
    ["空文件", Buffer.alloc(0)],
  ]);
  const original = evb_fixture(files, x64, legacy ? "7_80" : "10_70");
  const source = path.join(temp.path, "packed.exe");
  fs.writeFileSync(source, original);
  const native = new NativeFs(),
    handle = await native.open_file(source, "r");
  try {
    const archive = (await read_evb(handle))!;
    expect(archive.members.map((m) => m.name)).toEqual([...files.keys()]);
    for (const member of archive.members) {
      const target = path.join(temp.path, "out", member.name);
      await extract_evb_member(handle, member, target, native);
      expect(fs.readFileSync(target)).toEqual(files.get(member.name));
    }
  } finally {
    await handle.close();
  }
});

it.each(["path", "truncated", "unknown", "duplicate"])("拒绝损坏 EVB：%s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-evb-bad-"));
  let bytes = evb_fixture(
    new Map(
      kind === "duplicate"
        ? [
            ["safe.txt", Buffer.from("a")],
            ["SAFE.TXT", Buffer.from("b")],
          ]
        : [["safe.txt", Buffer.from("a")]],
    ),
  );
  if (kind === "path")
    Buffer.from("../x.txt", "utf16le").copy(
      bytes,
      bytes.indexOf(Buffer.from("safe.txt", "utf16le")),
    );
  if (kind === "truncated") bytes = bytes.subarray(0, bytes.length - 1);
  if (kind === "unknown") bytes.fill(0, 1024, 1150);
  const source = path.join(temp.path, "bad.exe");
  fs.writeFileSync(source, bytes);
  const handle = await new NativeFs().open_file(source, "r");
  try {
    await expect(read_evb(handle)).rejects.toThrow();
  } finally {
    await handle.close();
  }
});

it.each([false, true])("压缩块表省略尾部字段 %s 时仍核对解码总长度", async (short_table) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-evb-block-"));
  const compressed = Buffer.from(
    "5400686520717569636bec620e726f776ece66ae78806a756d7073ede47665757260743f6c617a79ea64fe67c000",
    "hex",
  );
  const table = Buffer.alloc(short_table ? 12 : 20);
  table.writeUInt32LE(table.length);
  table.writeUInt32LE(compressed.length, 8);
  const bytes = evb_fixture(new Map([["text.txt", Buffer.concat([table, compressed])]]));
  const name = bytes.indexOf(Buffer.from("text.txt\0", "utf16le"));
  bytes.writeUInt32LE(43, name + Buffer.byteLength("text.txt\0", "utf16le") + 3);
  const source = path.join(temp.path, "packed.exe");
  fs.writeFileSync(source, bytes);
  const native = new NativeFs(),
    handle = await native.open_file(source, "r");
  try {
    const archive = (await read_evb(handle))!,
      member = archive.members[0]!;
    const output = path.join(temp.path, "text.txt");
    await extract_evb_member(handle, member, output, native);
    expect(fs.readFileSync(output, "utf8")).toBe("The quick brown fox jumps over the lazy dog");
    await expect(
      extract_evb_member(handle, { ...member, size: 42 }, path.join(temp.path, "bad.txt"), native),
    ).rejects.toThrow();
  } finally {
    await handle.close();
  }
});
