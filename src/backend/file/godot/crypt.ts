import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { read_bytes, BINARY_IO_CHUNK_BYTES, type BinaryFileHandle } from "../shared/binary";

export const GODOT_CRYPT_HEADER_BYTES = 40;
export type GodotEncryptedBlock = Readonly<{
  offset: number;
  size: number;
  stored_size: number;
  md5: string;
  iv: Buffer;
}>;

/** PCK 内部加密块不带 GDEC magic，长度始终是明文长度。 */
export async function read_encrypted_block(
  handle: BinaryFileHandle,
  offset: number,
  end: number,
): Promise<GodotEncryptedBlock> {
  assert(offset >= 0 && offset + GODOT_CRYPT_HEADER_BYTES <= end, "Truncated encrypted PCK header");
  const header = await read_bytes(handle, offset, GODOT_CRYPT_HEADER_BYTES);
  const size = Number(header.readBigUInt64LE(16));
  const stored_size = GODOT_CRYPT_HEADER_BYTES + Math.ceil(size / 16) * 16;
  assert(
    Number.isSafeInteger(size) &&
      Number.isSafeInteger(offset + stored_size) &&
      offset + stored_size <= end,
    "Encrypted PCK block outside payload",
  );
  return {
    offset,
    size,
    stored_size,
    md5: header.subarray(0, 16).toString("hex"),
    iv: header.subarray(24, 40),
  };
}

/** 逐块去除加密补齐并校验明文摘要，取消检查随文件读取推进。 */
export async function* decrypt_block(
  handle: BinaryFileHandle,
  block: GodotEncryptedBlock,
  key: Uint8Array,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  assert.equal(key.length, 32, "Invalid Godot AES key length");
  const cipher = createDecipheriv("aes-256-cfb", key, block.iv);
  const hash = createHash("md5");
  const length = block.stored_size - GODOT_CRYPT_HEADER_BYTES;
  for (let at = 0; at < length; at += BINARY_IO_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const encrypted = await read_bytes(
      handle,
      block.offset + GODOT_CRYPT_HEADER_BYTES + at,
      Math.min(BINARY_IO_CHUNK_BYTES, length - at),
    );
    const plain = cipher
      .update(encrypted)
      .subarray(0, Math.max(0, Math.min(encrypted.length, block.size - at)));
    hash.update(plain);
    yield plain;
  }
  cipher.final();
  assert.equal(
    hash.digest("hex"),
    block.md5,
    "Encrypted PCK MD5 mismatch (invalid key or damaged data)",
  );
  signal?.throwIfAborted();
}
