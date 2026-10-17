// DXArchive 8 / WolfCrypt: UberWolf f4191375d289171b1f29dbc5ca320133b2b4b96a.
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { NativeFs } from "../../../native/native-fs";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { assert_game_path_spellings, validate_game_path } from "../source-file-paths";
import { BINARY_CHUNK_BYTES, write_bytes, type BinaryFileHandle } from "../shared/binary";
import { open_wolf_archive_crypt, xor, type WolfKey, type WolfKeyType } from "./archive-crypt";
import { decompress_huffman, decompress_dx_lz } from "./archive-codec";
import { WOLF_MAX_DATA_BYTES } from "./lz4";

const HEADER_BYTES = 64;
const FILE_RECORD_BYTES = 72;
const DIRECTORY_RECORD_BYTES = 32;
const MAX_MEMBERS = 1000000; // 成员数量上限，与目录区上限共同约束解析规模。
export type WolfArchiveMember = Readonly<{
  name: string;
  offset: number;
  size: number;
  lz_size: number;
  huffman_size: number;
  key: WolfKey | null;
}>;
export type WolfArchive = Readonly<{
  version: number;
  members: readonly WolfArchiveMember[];
  directories: readonly string[];
  chunks: (member: WolfArchiveMember) => AsyncGenerator<Buffer>;
}>;

/** 目录先整体验证，IO 始终按块进行，文件句柄由调用者持有。 */
export async function read_wolf_archive(
  handle: BinaryFileHandle,
  signal?: AbortSignal,
  resolve_key?: (type: WolfKeyType) => Promise<Buffer>,
): Promise<WolfArchive> {
  const {
    version,
    data_offset,
    directory_offset,
    file_table,
    dir_table,
    directory_size,
    flags,
    huffman_kb,
    directory,
    read,
    member_key,
  } = await open_wolf_archive_crypt(handle, resolve_key, signal);
  const bytes =
    flags & 2
      ? directory
      : await decompress_dx_lz(await decompress_huffman(directory, signal), signal);
  assert.equal(bytes.length, directory_size, "WOLF directory size mismatch");
  assert(
    file_table >= 0 &&
      dir_table >= file_table &&
      dir_table + DIRECTORY_RECORD_BYTES <= bytes.length,
    "Invalid WOLF directory tables",
  );
  /** 目录字段保留全一位哨兵，其余值必须可精确表示。 */
  const u64 = (at: number): number => {
    assert(at >= 0 && at + 8 <= bytes.length, "WOLF table entry exceeds directory");
    const value = bytes.readBigUInt64LE(at);
    if (value === 0xffffffffffffffffn) return -1;
    assert(value <= BigInt(Number.MAX_SAFE_INTEGER), "Unsafe WOLF table offset");
    return Number(value);
  };
  /** 名字表同时保存原拼写和密钥所需的大写字节。 */
  const name = (offset: number): { text: string; upper: Buffer } => {
    assert(offset >= 0 && offset + 4 <= file_table, "Invalid WOLF name offset");
    const start = offset + bytes.readUInt16LE(offset) * 4 + 4;
    const end = bytes.indexOf(0, start),
      upper_end = bytes.indexOf(0, offset + 4);
    assert(
      start < file_table &&
        end >= start &&
        end < file_table &&
        upper_end >= offset + 4 &&
        upper_end < start,
      "Invalid WOLF name bounds",
    );
    const text = new TextDecoder("shift-jis", { fatal: true }).decode(bytes.subarray(start, end));
    assert(
      text && text !== "." && text !== ".." && !/[\\/:]/u.test(text),
      "Invalid WOLF member name",
    );
    return { text, upper: bytes.subarray(offset + 4, upper_end) };
  };
  const members: WolfArchiveMember[] = [],
    directories: string[] = [],
    visited = new Set<number>(),
    paths = new Set<string>();
  const pending = [{ offset: 0, folder: "", keys: [] as Buffer[] }];
  while (pending.length) {
    await setImmediate();
    signal?.throwIfAborted();
    const { offset, folder, keys } = pending.pop()!;
    assert(!visited.has(offset), "WOLF directory cycle");
    visited.add(offset);
    assert(
      offset >= 0 && dir_table + offset + DIRECTORY_RECORD_BYTES <= bytes.length,
      "Invalid WOLF directory record",
    );
    const count = u64(dir_table + offset + 16),
      first = u64(dir_table + offset + 24);
    assert(
      count >= 0 &&
        count <= MAX_MEMBERS &&
        first >= 0 &&
        file_table + first + count * FILE_RECORD_BYTES <= dir_table,
      "Invalid WOLF member table",
    );
    for (let i = 0; i < count; i++) {
      if (i % 256 === 0) {
        await setImmediate();
        signal?.throwIfAborted();
      }
      const at = file_table + first + i * FILE_RECORD_BYTES;
      const entry = name(u64(at)),
        filename = folder + entry.text;
      validate_game_path(filename);
      assert(
        !paths.has(filename.toLowerCase()) && paths.size < MAX_MEMBERS,
        "Duplicate or excessive WOLF members: " + filename,
      );
      paths.add(filename.toLowerCase());
      if (u64(at + 8) & 16) {
        directories.push(filename);
        pending.push({
          offset: u64(at + 40),
          folder: filename + "/",
          keys: [entry.upper, ...keys],
        });
      } else {
        const member: WolfArchiveMember = {
          name: filename,
          offset: data_offset + u64(at + 40),
          size: u64(at + 48),
          lz_size: u64(at + 56),
          huffman_size: u64(at + 64),
          key: member_key([entry.upper, ...keys]),
        };
        const compressed = member.lz_size < 0 ? member.size : member.lz_size;
        const stored =
          member.huffman_size < 0
            ? compressed
            : member.huffman_size +
              (huffman_kb !== 255 && compressed > huffman_kb * 2048
                ? compressed - huffman_kb * 2048
                : 0);
        assert(
          member.size >= 0 &&
            member.offset >= HEADER_BYTES &&
            Number.isSafeInteger(member.offset + stored) &&
            stored >= 0 &&
            member.offset + stored <= directory_offset,
          "WOLF member exceeds data region: " + filename,
        );
        members.push(member);
      }
    }
  }
  assert_game_path_spellings([...directories, ...members.map((member) => member.name)]);
  const index = new ProjectAssetPathIndex();
  for (const member of members) index.add(member.name);
  /** 首尾 Huffman 区域合并还原，中间原始区域直接分块传输。 */
  async function* packed_chunks(member: WolfArchiveMember): AsyncGenerator<Buffer> {
    const target = member.lz_size < 0 ? member.size : member.lz_size;
    let middle = target,
      at = member.offset,
      position = member.size,
      sides: Buffer | undefined,
      side = 0;
    if (member.huffman_size >= 0) {
      const encoded = await read(at, member.huffman_size);
      for (let offset = 0; offset < encoded.length; offset += BINARY_CHUNK_BYTES) {
        await setImmediate();
        signal?.throwIfAborted();
        xor(encoded.subarray(offset, offset + BINARY_CHUNK_BYTES), member.key, position + offset);
      }
      sides = await decompress_huffman(encoded, signal);
      if (huffman_kb === 255 || target <= huffman_kb * 2048) {
        assert.equal(sides.length, target);
        yield sides;
        return;
      }
      side = huffman_kb * 1024;
      assert.equal(sides.length, side * 2);
      yield sides.subarray(0, side);
      middle -= side * 2;
      at += member.huffman_size;
      position += member.huffman_size;
    }
    for (let pos = 0; pos < middle; pos += BINARY_CHUNK_BYTES)
      yield xor(
        await read(at + pos, Math.min(BINARY_CHUNK_BYTES, middle - pos)),
        member.key,
        position + pos,
      );
    if (sides) yield sides.subarray(side);
  }
  /** 只对需要 LZ 解释的成员聚合内容，归档整体保持流式读取。 */
  async function* chunks(member: WolfArchiveMember): AsyncGenerator<Buffer> {
    if (member.lz_size < 0) {
      yield* packed_chunks(member);
      return;
    }
    assert(
      member.size <= WOLF_MAX_DATA_BYTES && member.lz_size <= WOLF_MAX_DATA_BYTES,
      "WOLF compressed member exceeds limit",
    );
    const parts: Buffer[] = [];
    for await (const chunk of packed_chunks(member)) parts.push(chunk);
    const content = await decompress_dx_lz(Buffer.concat(parts), signal);
    assert.equal(content.length, member.size, "WOLF member size mismatch");
    for (let at = 0; at < content.length; at += BINARY_CHUNK_BYTES) {
      await setImmediate();
      signal?.throwIfAborted();
      yield content.subarray(at, at + BINARY_CHUNK_BYTES);
    }
  }
  return { version, members, directories, chunks };
}

/** 零字节成员也创建目标文件，异常路径由外层事务负责清理。 */
export async function extract_wolf_member(
  archive: WolfArchive,
  member: WolfArchiveMember,
  target: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  const output = await fs.open_file(target, "w");
  try {
    let position = 0;
    for await (const bytes of archive.chunks(member)) {
      signal?.throwIfAborted();
      await write_bytes(output, bytes, position);
      position += bytes.length;
    }
    assert.equal(position, member.size, "WOLF extracted size mismatch");
  } finally {
    await output.close();
  }
}
