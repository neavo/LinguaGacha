// EVB 文件表与 PE 恢复参考 mos9527/evbunpack（Apache-2.0）。
import assert from "node:assert/strict";
import type { NativeFs } from "../../../../native/native-fs";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";
import { assert_game_path_spellings, validate_game_path } from "../../source-file-paths";
import {
  read_pe,
  validate_evb_layout,
  OFFSETS,
  type Variant,
  type PE,
  type EVBExecutable,
} from "./pe";
import { decompress_aplib } from "./aplib";
import {
  copy_range,
  read_bytes,
  write_bytes,
  BINARY_CHUNK_BYTES,
  type BinaryFileHandle,
} from "../binary";

const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_BLOCK_BYTES = 64 * 1024 * 1024;
const MAGIC = Buffer.from("EVB\0");
export type EVBMember = Readonly<{ name: string; offset: number; stored: number; size: number }>;
export type EVBArchive = EVBExecutable & Readonly<{ members: readonly EVBMember[] }>;

/** PE 头有界读取；非 PE 文件是普通 EXE 候选，已带 EVB 节的损坏文件明确失败。 */
export async function read_evb(
  handle: BinaryFileHandle,
  signal?: AbortSignal,
): Promise<EVBArchive | null> {
  const length = (await handle.stat()).size;
  if (length < 64) return null;
  const dos = await read_bytes(handle, 0, 64);
  if (dos.readUInt16LE() !== 0x5a4d) return null;
  const offset = dos.readUInt32LE(60);
  if (offset < 64 || offset + 24 > Math.min(length, MAX_HEADER_BYTES)) return null;
  const coff = await read_bytes(handle, offset, 24);
  if (coff.readUInt32LE() !== 0x4550) return null;
  const end = offset + 24 + coff.readUInt16LE(20) + coff.readUInt16LE(6) * 40;
  assert(end <= Math.min(length, MAX_HEADER_BYTES), "Unsupported PE header size");
  const pe = read_pe(await read_bytes(handle, 0, end), length);
  const section = pe.sections.find((s) => s.name === ".enigma1");
  if (!section) return null;
  const valid: { variant: Variant; members: EVBMember[] }[] = [];
  for (const variant of Object.keys(OFFSETS) as Variant[]) {
    try {
      signal?.throwIfAborted();
      await validate_evb_layout(handle, pe, variant);
      valid.push({ variant, members: await read_members(handle, pe, variant === "7_80", signal) });
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      // 探测分支的结构不匹配属于预期，只有唯一完整匹配可以进入准备。
    }
  }
  assert(valid.length === 1, "Unsupported or ambiguous EVB structure");
  return { pe, length, ...valid[0]! };
}

/** 文件树通过小窗口随机读取，旧版交错载荷也无需整包加载。 */
async function read_members(
  handle: BinaryFileHandle,
  pe: PE,
  legacy: boolean,
  signal?: AbortSignal,
): Promise<EVBMember[]> {
  const section = pe.sections.find((s) => s.name === ".enigma1")!;
  const end = section.raw + section.size;
  let magic = -1;
  const header_end = Math.min(end, section.raw + MAX_HEADER_BYTES);
  for (let at = section.raw; at < header_end; at += BINARY_CHUNK_BYTES - 3) {
    const block = await read_bytes(handle, at, Math.min(BINARY_CHUNK_BYTES, header_end - at));
    const found = block.indexOf(MAGIC);
    if (found >= 0) {
      magic = at + found;
      break;
    }
  }
  assert(magic >= 0, "Missing EVB file tree");
  let window: Buffer = Buffer.alloc(0);
  let window_at = 0;
  /** 目录字段共享读取窗口，旧版载荷跳转时重新定位。 */
  async function bytes(at: number, size: number): Promise<Buffer> {
    assert(at >= section.raw && at + size <= end, "EVB tree outside section");
    if (at < window_at || at + size > window_at + window.length) {
      window_at = at;
      window = await read_bytes(handle, at, Math.min(BINARY_CHUNK_BYTES, end - at));
    }
    return window.subarray(at - window_at, at - window_at + size);
  }
  const u32 = async (at: number) => (await bytes(at, 4)).readUInt32LE(); // EVB 目录字段固定为小端序。
  let position = magic + 64;
  const main_size = await u32(position),
    main_count = await u32(position + 12);
  let data = position + main_size + 4;
  const data_start = data; // 新版目录必须在独立载荷区之前结束。
  position += legacy ? main_size + 4 : 15;
  const result: EVBMember[] = [],
    names = new Set<string>(),
    spellings: string[] = [],
    paths = new ProjectAssetPathIndex();
  let count = 0;
  /** 遍历有界文件树，同时检查名称占用和成员的磁盘范围。 */
  async function node(parent: string, depth: number): Promise<void> {
    assert(depth < 128 && ++count < 1000000, "EVB tree limit");
    signal?.throwIfAborted();
    const start = position,
      size = await u32(position),
      children = await u32(position + 12);
    position += 16;
    const units: number[] = [];
    while (true) {
      const unit = (await bytes(position, 2)).readUInt16LE();
      position += 2;
      if (!unit) break;
      assert(units.length < 32768, "EVB name limit");
      units.push(unit);
    }
    let name = String.fromCharCode(...units);
    const kind = (await bytes(position++, 1))[0];
    if (depth === 0 && kind === 3 && name === "%DEFAULT FOLDER%") name = "";
    else {
      assert(!/[\\/]/u.test(name), "Invalid EVB component");
      validate_game_path(name);
    }
    const full = [parent, name].filter(Boolean).join("/");
    assert(!names.has(full.toLowerCase()), "Duplicate EVB member");
    names.add(full.toLowerCase());
    if (full) spellings.push(full);
    if (kind === 3) {
      position = legacy ? start + size + 4 : position + 25;
      for (let i = 0; i < children; i++) await node(full, depth + 1);
    } else {
      assert(kind === 2 && children === 0, "Unsupported EVB node");
      if (legacy) position = start + size + 4 - 49;
      const length = await u32(position + 2),
        stored = await u32(position + (legacy ? 41 : 49));
      const offset = legacy ? position + 49 : data;
      assert(offset >= section.raw && offset + stored <= end, "EVB member outside section");
      validate_game_path(full);
      paths.add(full);
      result.push({ name: full, offset, stored, size: length });
      if (legacy) position = offset + stored;
      else {
        position += 53;
        data += stored;
      }
    }
  }
  for (let i = 0; i < main_count; i++) await node("", 0);
  assert_game_path_spellings(spellings);
  assert(legacy || position <= data_start, "EVB tree overlaps payload");
  for (const name of names) {
    const conflict = name ? paths.find_conflict(name) : null;
    assert(conflict === null || conflict === name, "EVB file blocks directory");
  }
  return result;
}

/** 未压缩成员直接复制，压缩成员逐块解码并核对总长度。 */
export async function extract_evb_member(
  handle: BinaryFileHandle,
  member: EVBMember,
  destination: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  fs.ensure_parent_dir(destination);
  const output = await fs.open_file(destination, "wx");
  try {
    if (member.size === member.stored) {
      await copy_range(handle, output, member.offset, member.size, 0, signal);
      return;
    }
    const table = (await read_bytes(handle, member.offset, 4)).readUInt32LE();
    assert(
      table >= 12 && (table % 12 === 0 || (table - 8) % 12 === 0) && table <= member.stored,
      "Invalid EVB chunk table",
    );
    let cursor = member.offset + table,
      total = 0;
    for (let at = member.offset + 8; at < member.offset + table; at += 12) {
      signal?.throwIfAborted();
      const size = (await read_bytes(handle, at, 4)).readUInt32LE();
      assert(
        size > 0 && size <= MAX_BLOCK_BYTES && cursor + size <= member.offset + member.stored,
        "Invalid EVB block size",
      );
      const bytes = decompress_aplib(
        await read_bytes(handle, cursor, size),
        Math.min(MAX_BLOCK_BYTES, member.size - total),
      );
      await write_bytes(output, bytes, total);
      cursor += size;
      total += bytes.length;
    }
    assert(
      cursor === member.offset + member.stored && total === member.size,
      "EVB output size mismatch",
    );
  } finally {
    await output.close();
  }
}
