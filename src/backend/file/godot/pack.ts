import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import {
  assert_game_path_spellings,
  assert_regular_path,
  validate_game_path,
} from "../source-file-paths";
import {
  read_bytes,
  write_bytes,
  BINARY_IO_CHUNK_BYTES,
  type BinaryFileHandle,
} from "../shared/binary";
import { Reader, utf8 } from "./binary";
import { decrypt_block, read_encrypted_block } from "./crypt";

const PACK_HEADER_BYTES = 96,
  DIRECTORY_MAX_BYTES = 64 * 1024 * 1024,
  DIRECTORY_WINDOW_BYTES = 64 * 1024;
export type PackMember = Readonly<{
  name: string;
  offset: number;
  size: number; // 明文长度。
  stored_size: number; // 载体中的物理占用，包含加密头与补齐。
  md5: string;
  encrypted: boolean;
}>;
export type GodotPackHeader = Readonly<{
  start: number;
  end: number;
  version: number;
  engine: readonly number[];
  flags: number;
  base: number;
  directory: number;
  count: number;
}>;
export type GodotPack = GodotPackHeader & Readonly<{ members: readonly PackMember[] }>;

/** EXE 只接受有尾部长度协议的内嵌包，未知 PE section 布局明确拒绝。 */
export async function read_pack_header(
  handle: BinaryFileHandle,
  signal?: AbortSignal,
): Promise<GodotPackHeader> {
  signal?.throwIfAborted();
  const length = (await handle.stat()).size;
  assert(length >= PACK_HEADER_BYTES + 4, "Truncated Godot pack");
  let start = 0,
    end = length;
  if ((await read_bytes(handle, 0, 4)).toString() !== "GDPC") {
    const footer = new Reader(await read_bytes(handle, length - 12, 12));
    const size = footer.u64();
    assert.equal(footer.take(4).toString(), "GDPC", "Unsupported embedded PCK layout");
    assert(size >= PACK_HEADER_BYTES + 4 && size <= length - 12, "Invalid embedded PCK length");
    start = length - 12 - size;
    end -= 12;
  }
  const header = new Reader(await read_bytes(handle, start, 40));
  assert.equal(header.take(4).toString(), "GDPC");
  const version = header.u32();
  assert([2, 3, 4].includes(version), "Unsupported PCK version");
  const engine = [header.u32(), header.u32(), header.u32()],
    flags = header.u32();
  assert.equal(engine[0], 4, "Unsupported Godot engine");
  assert((flags & ~3) === 0, "Sparse/unknown PCK flags");
  const base = header.u64() + (version >= 3 || flags & 2 ? start : 0);
  const directory = version >= 3 ? start + header.u64() : start + PACK_HEADER_BYTES;
  assert(
    Number.isSafeInteger(base) &&
      Number.isSafeInteger(directory) &&
      directory >= start + PACK_HEADER_BYTES &&
      directory + 4 <= end,
    "Invalid PCK directory",
  );
  const count = (await read_bytes(handle, directory, 4)).readUInt32LE();
  assert(count <= 1000000 && count * 44 + 4 <= DIRECTORY_MAX_BYTES, "Invalid PCK member count");
  return { start, end, version, engine, flags, base, directory, count };
}

/** 准备阶段校验完整目录，物理区间按密文占用计算。 */
export async function read_pack(
  handle: BinaryFileHandle,
  signal?: AbortSignal,
  key?: Uint8Array,
): Promise<GodotPack> {
  const header = await read_pack_header(handle, signal);
  const { start, end, directory, base, count } = header;
  let at = directory + 4;
  let plain: Reader | undefined;
  let window: Buffer = Buffer.alloc(0),
    window_start = 0;
  if (header.flags & 1) {
    assert(key, "Godot PCK requires an encryption key");
    const block = await read_encrypted_block(handle, at, end);
    assert(block.size <= DIRECTORY_MAX_BYTES, "PCK directory exceeds processing limit");
    const chunks: Buffer[] = [];
    for await (const chunk of decrypt_block(handle, block, key, signal)) chunks.push(chunk);
    plain = new Reader(Buffer.concat(chunks));
    at += block.stored_size;
  }
  /** 逻辑字段读取复用目录窗口，加密目录直接消费已验证明文。 */
  const take = async (size: number): Promise<Buffer> => {
    signal?.throwIfAborted();
    if (plain) return plain.take(size);
    assert(
      at + size <= end && at + size - directory <= DIRECTORY_MAX_BYTES,
      "PCK directory exceeds processing limit",
    );
    if (at < window_start || at + size > window_start + window.length) {
      window_start = at;
      window = await read_bytes(
        handle,
        at,
        Math.min(
          Math.max(DIRECTORY_WINDOW_BYTES, size),
          end - at,
          DIRECTORY_MAX_BYTES - (at - directory),
        ),
      );
    }
    const bytes = window.subarray(at - window_start, at - window_start + size);
    // 预读取不推进目录逻辑位置，区间检查仍以实际消费的字段为准。
    at += size;
    return bytes;
  };
  const members: PackMember[] = [];
  for (let index = 0; index < count; index++) {
    const size = (await take(4)).readUInt32LE();
    assert(size > 0 && size <= 65536, "Invalid PCK path length");
    const record = new Reader(await take(size + 36)),
      name_bytes = record.take(size),
      zero = name_bytes.indexOf(0);
    if (zero >= 0)
      assert(
        name_bytes.subarray(zero).every((byte) => byte === 0),
        "Invalid PCK path padding",
      );
    const name = utf8
      .decode(zero < 0 ? name_bytes : name_bytes.subarray(0, zero))
      .replace(/^res:\/\//u, "");
    const offset = base + record.u64(),
      length = record.u64(),
      md5 = record.take(16).toString("hex");
    const flags = record.u32();
    assert((flags & ~1) === 0, "Removal/delta/unknown PCK member");
    const encrypted = Boolean(flags & 1);
    const block = encrypted ? await read_encrypted_block(handle, offset, end) : null;
    if (block) {
      assert.equal(block.size, length, "Encrypted PCK member length mismatch");
      assert.equal(block.md5, md5, "Encrypted PCK member digest mismatch");
    }
    const stored_size = block?.stored_size ?? length;
    assert(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(offset + stored_size) &&
        offset >= start + PACK_HEADER_BYTES &&
        offset + stored_size <= end,
      "PCK member outside payload",
    );
    members.push({ name, offset, size: length, stored_size, md5, encrypted });
  }
  if (plain) assert.equal(plain.at, plain.b.length, "Encrypted PCK directory length mismatch");
  const paths = new ProjectAssetPathIndex();
  assert_game_path_spellings(members.map((member) => member.name));
  for (const member of members) {
    validate_game_path(member.name);
    paths.add(member.name);
    assert(
      !member.stored_size || member.offset + member.stored_size <= directory || member.offset >= at,
      "PCK member overlaps directory",
    );
  }
  const sorted = members.filter((member) => member.stored_size).sort((a, b) => a.offset - b.offset);
  for (let index = 1; index < sorted.length; index++)
    assert(
      sorted[index - 1]!.offset + sorted[index - 1]!.stored_size <= sorted[index]!.offset,
      "Overlapping PCK payload",
    );
  return { ...header, members };
}

/** 被覆盖的成员也消费同一校验流，损坏载荷不能随资源叠加被隐藏。 */
export async function* read_pack_member(
  handle: BinaryFileHandle,
  member: PackMember,
  signal?: AbortSignal,
  key?: Uint8Array,
): AsyncGenerator<Buffer> {
  signal?.throwIfAborted();
  if (member.encrypted && member.size > 0) {
    // 空文件无密文，统一在下方核对空明文摘要。
    assert(key, "Godot PCK requires an encryption key");
    const block = await read_encrypted_block(
      handle,
      member.offset,
      member.offset + member.stored_size,
    );
    assert.equal(block.size, member.size, "Encrypted PCK member length changed");
    assert.equal(block.md5, member.md5, "Encrypted PCK member digest changed");
    yield* decrypt_block(handle, block, key, signal); // 加密流已核对目录摘要，避免再次计算同一份 MD5。
    return;
  }
  const digest = createHash("md5");
  for (let at = 0; at < member.size; at += BINARY_IO_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const bytes = await read_bytes(
      handle,
      member.offset + at,
      Math.min(BINARY_IO_CHUNK_BYTES, member.size - at),
    );
    digest.update(bytes);
    yield bytes;
  }
  assert.equal(digest.digest("hex"), member.md5, "PCK member MD5: " + member.name);
  signal?.throwIfAborted();
}

/** 每次复制同时校验成员 MD5，失败或取消后只移除本次独占创建的候选。 */
export async function extract_pack_member(
  handle: BinaryFileHandle,
  member: PackMember,
  destination: string,
  fs: NativeFs,
  signal?: AbortSignal,
  key?: Uint8Array,
): Promise<void> {
  signal?.throwIfAborted();
  assert_regular_path(destination, fs);
  await fs.make_dir_async(path.dirname(destination));
  const output = await fs.open_file(destination, "wx");
  let complete = false;
  try {
    let at = 0;
    for await (const bytes of read_pack_member(handle, member, signal, key)) {
      await write_bytes(output, bytes, at);
      at += bytes.length;
    }
    complete = true;
  } finally {
    await output.close();
    if (!complete) fs.unlink(destination);
  }
}
