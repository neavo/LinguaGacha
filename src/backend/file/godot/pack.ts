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

const PACK_HEADER_BYTES = 96,
  DIRECTORY_MAX_BYTES = 64 * 1024 * 1024;
export type PackMember = Readonly<{ name: string; offset: number; size: number; md5: string }>;
export type GodotPack = Readonly<{
  start: number;
  end: number;
  version: number;
  engine: readonly number[];
  members: readonly PackMember[];
}>;

/** EXE 只接受有尾部长度协议的内嵌包，未知 PE section 布局明确拒绝。 */
export async function read_pack(
  handle: BinaryFileHandle,
  signal?: AbortSignal,
): Promise<GodotPack> {
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
  assert((flags & ~2) === 0, "Encrypted/sparse/unknown PCK flags");
  const base = header.u64() + (version >= 3 || flags & 2 ? start : 0);
  const directory = version >= 3 ? start + header.u64() : start + PACK_HEADER_BYTES;
  assert(
    Number.isSafeInteger(base) &&
      Number.isSafeInteger(directory) &&
      directory >= start + PACK_HEADER_BYTES &&
      directory + 4 <= end,
    "Invalid PCK directory",
  );
  let at = directory;
  const take = async (size: number): Promise<Buffer> => {
    signal?.throwIfAborted();
    assert(
      at + size <= end && at + size - directory <= DIRECTORY_MAX_BYTES,
      "PCK directory exceeds processing limit",
    );
    const bytes = await read_bytes(handle, at, size);
    at += size;
    return bytes;
  };
  const count = (await take(4)).readUInt32LE();
  assert(count <= 1000000 && count * 44 + 4 <= DIRECTORY_MAX_BYTES, "Invalid PCK member count");
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
    assert.equal(record.u32(), 0, "Encrypted/removal/delta PCK member");
    assert(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(offset + length) &&
        offset >= start + PACK_HEADER_BYTES &&
        offset + length <= end,
      "PCK member outside payload",
    );
    members.push({ name, offset, size: length, md5 });
  }
  const paths = new ProjectAssetPathIndex();
  assert_game_path_spellings(members.map((member) => member.name));
  for (const member of members) {
    validate_game_path(member.name);
    paths.add(member.name);
    assert(
      !member.size || member.offset + member.size <= directory || member.offset >= at,
      "PCK member overlaps directory",
    );
  }
  const sorted = members.filter((member) => member.size).sort((a, b) => a.offset - b.offset);
  for (let index = 1; index < sorted.length; index++)
    assert(
      sorted[index - 1]!.offset + sorted[index - 1]!.size <= sorted[index]!.offset,
      "Overlapping PCK payload",
    );
  return { start, end, version, engine, members };
}

/** 每次复制同时校验成员 MD5，失败或取消后只移除本次独占创建的候选。 */
export async function extract_pack_member(
  handle: BinaryFileHandle,
  member: PackMember,
  destination: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  assert_regular_path(destination, fs);
  await fs.make_dir_async(path.dirname(destination));
  const output = await fs.open_file(destination, "wx");
  let complete = false;
  try {
    const digest = createHash("md5");
    for (let at = 0; at < member.size; at += BINARY_IO_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const bytes = await read_bytes(
        handle,
        member.offset + at,
        Math.min(BINARY_IO_CHUNK_BYTES, member.size - at),
      );
      digest.update(bytes);
      await write_bytes(output, bytes, at);
    }
    assert.equal(digest.digest("hex"), member.md5, "PCK member MD5: " + member.name);
    signal?.throwIfAborted();
    complete = true;
  } finally {
    await output.close();
    if (!complete) fs.unlink(destination);
  }
}
