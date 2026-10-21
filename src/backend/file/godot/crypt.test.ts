import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { godot_encrypted_block_fixture } from "../../../test/godot-fixture";
import { BINARY_IO_CHUNK_BYTES } from "../shared/binary";
import { decrypt_block, read_encrypted_block } from "./crypt";

it("加密块跨读取边界解密，按明文长度去除补齐", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-crypt-"));
  const key = Buffer.alloc(32, 37),
    plain = Buffer.alloc(BINARY_IO_CHUNK_BYTES + 17, 42);
  const encrypted = godot_encrypted_block_fixture(plain, key),
    file = path.join(temp.path, "block");
  fs.writeFileSync(file, encrypted);
  const input = await new NativeFs().open_file(file, "r");
  try {
    const block = await read_encrypted_block(input, 0, encrypted.length);
    expect(block.stored_size).toBe(encrypted.length);
    expect(
      Buffer.concat(await Array.fromAsync(decrypt_block(input, block, key))).equals(plain),
    ).toBe(true);
  } finally {
    await input.close();
  }
});

it.each(["key", "payload", "length"])("加密块拒绝错误或损坏：%s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-crypt-invalid-"));
  const key = Buffer.alloc(32, 37),
    encrypted = godot_encrypted_block_fixture(Buffer.from("payload"), key);
  if (kind === "payload") encrypted[40] = encrypted[40]! ^ 1;
  const file = path.join(temp.path, "block");
  fs.writeFileSync(file, encrypted);
  const input = await new NativeFs().open_file(file, "r");
  try {
    if (kind === "length")
      await expect(read_encrypted_block(input, 0, encrypted.length - 1)).rejects.toThrow();
    else {
      const block = await read_encrypted_block(input, 0, encrypted.length);
      await expect(
        Array.fromAsync(decrypt_block(input, block, kind === "key" ? Buffer.alloc(32, 1) : key)),
      ).rejects.toThrow("MD5");
    }
  } finally {
    await input.close();
  }
});
