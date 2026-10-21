import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { godot_pack_fixture } from "../../../test/godot-fixture";
import { read_pack, extract_pack_member } from "./pack";

it.each([2, 3, 4])("PCK v%s 读取相对和绝对 file_base、内嵌尾部并按 MD5 展开", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-pack-"));
  const native = new NativeFs();
  for (const relative of [true, false])
    for (const embedded of [true, false]) {
      const bytes = godot_pack_fixture(new Map([["目录/a.txt", Buffer.from("成员")]]), {
        version,
        relative,
        prefix: embedded ? Buffer.alloc(127, 42) : undefined,
      });
      const source = path.join(temp.path, "source"),
        destination = path.join(temp.path, `${relative}-${embedded}`);
      fs.writeFileSync(source, bytes);
      const handle = await native.open_file(source, "r");
      try {
        const pack = await read_pack(handle);
        expect(pack.version).toBe(version);
        expect(pack.start).toBe(embedded ? 127 : 0);
        expect(pack.members.map((member) => member.name)).toEqual(["目录/a.txt"]);
        await extract_pack_member(handle, pack.members[0]!, destination, native);
        expect(fs.readFileSync(destination, "utf8")).toBe("成员");
      } finally {
        await handle.close();
      }
    }
});

it.each(["../escape", "a\\b", "a:b", "NUL.txt", "a.", "a/../b", "/root", "backup_lg/a", "a\0x"])(
  "非法 PCK 路径在展开前失败：%s",
  async (name) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-path-"));
    const source = path.join(temp.path, "bad.pck"),
      native = new NativeFs();
    fs.writeFileSync(source, godot_pack_fixture(new Map([[name, Buffer.from("x")]])));
    const handle = await native.open_file(source, "r");
    try {
      await expect(read_pack(handle)).rejects.toThrow();
    } finally {
      await handle.close();
    }
  },
);

it.each([
  "case",
  "directory",
  "flags",
  "member-flags",
  "overlap",
  "unsafe-offset",
  "directory-offset",
])("PCK 结构边界拒绝 %s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-invalid-"));
  const files =
    kind === "case"
      ? new Map([
          ["A/a", Buffer.from("x")],
          ["a/b", Buffer.from("y")],
        ])
      : kind === "directory"
        ? new Map([
            ["a", Buffer.from("x")],
            ["a/b", Buffer.from("y")],
          ])
        : new Map([["a", Buffer.from("x")]]);
  const bytes = godot_pack_fixture(files, { version: 3 });
  const record = 104 + bytes.readUInt32LE(100);
  if (kind === "flags") bytes.writeUInt32LE(4, 20);
  if (kind === "member-flags") bytes.writeUInt32LE(1, record + 32);
  if (kind === "overlap") {
    bytes.writeBigUInt64LE(96n, 24);
    bytes.writeBigUInt64LE(0n, record);
  }
  if (kind === "unsafe-offset") bytes.writeBigUInt64LE(2n ** 63n, record);
  if (kind === "directory-offset") bytes.writeBigUInt64LE(1n, 32);
  const source = path.join(temp.path, "bad.pck"),
    native = new NativeFs();
  fs.writeFileSync(source, bytes);
  const handle = await native.open_file(source, "r");
  try {
    await expect(read_pack(handle)).rejects.toThrow();
  } finally {
    await handle.close();
  }
});

it.each(["md5", "cancel", "short-read"])("展开 %s 失败关闭句柄并删除未完成候选", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-extract-"));
  const source = path.join(temp.path, "source"),
    destination = path.join(temp.path, "destination"),
    native = new NativeFs();
  fs.writeFileSync(source, godot_pack_fixture(new Map([["a", Buffer.from("payload")]])));
  const handle = await native.open_file(source, "r+");
  try {
    const member = (await read_pack(handle)).members[0]!;
    if (kind === "md5") await handle.write(Buffer.from("x"), 0, 1, member.offset);
    if (kind === "short-read") await handle.truncate(member.offset + 1);
    await expect(
      extract_pack_member(
        handle,
        member,
        destination,
        native,
        kind === "cancel" ? AbortSignal.abort() : undefined,
      ),
    ).rejects.toThrow();
    expect(fs.existsSync(destination)).toBe(false);
  } finally {
    await handle.close();
  }
});

it.each([false, true])("标准加密目录=%s，混合成员按目录解密展开", async (encrypt_directory) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-encrypted-"));
  const native = new NativeFs(),
    key = Buffer.alloc(32, 37);
  const files = new Map([
    ["a", Buffer.from("encrypted member")],
    ["b", Buffer.from("plain")],
  ]);
  const source = path.join(temp.path, "encrypted.pck");
  fs.writeFileSync(
    source,
    godot_pack_fixture(files, {
      version: 4,
      encryption_key: key,
      encrypt_directory,
      encrypted_members: ["a"],
    }),
  );
  const handle = await native.open_file(source, "r+");
  try {
    const pack = await read_pack(handle, undefined, key),
      member = pack.members[0]!;
    const output = path.join(temp.path, "output");
    await extract_pack_member(handle, member, output, native, undefined, key);
    expect(fs.readFileSync(output).equals(files.get("a")!)).toBe(true);
    if (encrypt_directory)
      await expect(read_pack(handle, undefined, Buffer.alloc(32, 1))).rejects.toThrow("MD5");
  } finally {
    await handle.close();
  }
});
