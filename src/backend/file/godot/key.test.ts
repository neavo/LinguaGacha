import { BINARY_IO_CHUNK_BYTES } from "../shared/binary";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { godot_executable_fixture, godot_pack_fixture } from "../../../test/godot-fixture";
import { read_pack, read_pack_header } from "./pack";
import { create_pack_key_finder } from "./key";
import { GODOT_CRYPT_HEADER_BYTES } from "./crypt";

it.each(["simd", "pointer", "cross-chunk"])(
  "自动密钥候选与扫描：%s",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-key-scan-"));
    const native = new NativeFs(),
      key = Buffer.alloc(32, 91);
    const scan = kind === "cross-chunk";
    const key_offset = kind === "cross-chunk" ? 1536 + BINARY_IO_CHUNK_BYTES - 16 : 1600;
    const exe = godot_executable_fixture(key, key_offset, scan);
    if (kind === "pointer") {
      exe.writeBigUInt64LE(BigInt(0x140000000 + key_offset + 3584), 1536);
      exe.writeInt32LE(1536 - 535, 531);
    }
    const executable = path.join(temp.path, "game.exe"),
      pack = path.join(temp.path, "game.pck");
    fs.writeFileSync(executable, exe);
    fs.writeFileSync(
      pack,
      godot_pack_fixture(new Map([["name", Buffer.from("payload")]]), {
        encryption_key: key,
        encrypt_directory: true,
        resource_prefix: false,
      }),
    );
    const input = await native.open_file(executable, "r"),
      payload = await native.open_file(pack, "r");
    try {
      const header = await read_pack_header(payload);
      const pending = create_pack_key_finder(
        input,
        exe.length,
      )({ payload, offset: header.directory + 4, end: header.end, kind: "directory" });
      expect(await pending).toEqual(key);
    } finally {
      await input.close();
      await payload.close();
    }
  },
  15000,
);

it.each(["directory", "project", "unknown", "broken-prefix", "digest-mismatch"])(
  "任务内密钥复用与重新发现：%s",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-key-reuse-"));
    const native = new NativeFs(),
      first = Buffer.alloc(32, 19),
      second = Buffer.alloc(32, 27);
    const exe = godot_executable_fixture(first);
    second.copy(exe, 1700);
    native.write_file_sync(path.join(temp.path, "game.exe"), exe);
    const executable = await native.open_file(path.join(temp.path, "game.exe"), "r");
    const reads = vi.spyOn(executable, "read");
    const find = create_pack_key_finder(executable, exe.length);
    try {
      for (const [index, key] of [first, first, second, second].entries()) {
        const directory = kind === "directory";
        const bytes = godot_pack_fixture(
          new Map([
            [
              "project.binary",
              Buffer.from(kind === "broken-prefix" ? "BAD!payload" : "ECFGpayload"),
            ],
          ]),
          {
            encryption_key: key,
            encrypt_directory: directory,
            encrypted_members: ["project.binary"],
          },
        );
        native.write_file_sync(path.join(temp.path, "probe.pck"), bytes);
        const payload = await native.open_file(path.join(temp.path, "probe.pck"), "r+");
        try {
          const header = await read_pack_header(payload);
          const offset = directory
            ? header.directory + 4
            : (await read_pack(payload)).members[0]!.offset;
          const probe = {
            payload,
            offset,
            end: header.end,
            kind: directory
              ? ("directory" as const)
              : kind === "unknown"
                ? ("unknown" as const)
                : ("project" as const),
          };
          const previous_reads = reads.mock.calls.length;
          if (kind === "digest-mismatch" && index === 1) {
            // 修改实际密文，前四字节仍为 ECFG，但完整 MD5 必须拒绝候选。
            const damaged = offset + GODOT_CRYPT_HEADER_BYTES + 6;
            await payload.write(Buffer.from([bytes[damaged]! ^ 1]), 0, 1, damaged);
            await expect(find(probe)).rejects.toThrow(
              "Could not locate a valid Godot encryption key",
            );
          } else {
            expect(await find(probe)).toEqual(key);
            if (index === 1 || index === 3) expect(reads.mock.calls.length).toBe(previous_reads);
          }
        } finally {
          await payload.close();
        }
      }
    } finally {
      await executable.close();
    }
  },
);

it.each(["cancel", "io", "truncated"])("复用密钥仍传播 %s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-key-error-"));
  const native = new NativeFs(),
    key = Buffer.alloc(32, 61),
    exe = godot_executable_fixture(key),
    controller = new AbortController();
  native.write_file_sync(path.join(temp.path, "game.exe"), exe);
  native.write_file_sync(
    path.join(temp.path, "game.pck"),
    godot_pack_fixture(new Map([["project.binary", Buffer.from("ECFGpayload")]]), {
      encryption_key: key,
      encrypted_members: ["project.binary"],
    }),
  );
  const executable = await native.open_file(path.join(temp.path, "game.exe"), "r"),
    payload = await native.open_file(path.join(temp.path, "game.pck"), "r+");
  try {
    const pack = await read_pack(payload),
      find = create_pack_key_finder(executable, exe.length, controller.signal);
    const probe = {
      payload,
      offset: pack.members[0]!.offset,
      end: pack.end,
      kind: "project" as const,
    };
    expect(await find(probe)).toEqual(key);
    if (kind === "cancel") controller.abort(new Error("key scan cancelled"));
    if (kind === "io")
      vi.spyOn(payload, "read").mockRejectedValueOnce(new Error("probe IO failure"));
    if (kind === "truncated") await payload.truncate(probe.offset + 10);
    await expect(find(probe)).rejects.toThrow(
      kind === "cancel"
        ? "key scan cancelled"
        : kind === "io"
          ? "probe IO failure"
          : "Truncated game file",
    );
  } finally {
    await executable.close();
    await payload.close();
  }
});
