import { setImmediate } from "node:timers/promises";
import type { NativeFs } from "../../../native/native-fs";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { validate_zip_member_path } from "../shared/zip-members";
import {
  read_bytes,
  write_bytes,
  BINARY_IO_CHUNK_BYTES,
  BINARY_COMPUTE_STEP_BYTES,
  type BinaryFileHandle,
} from "../shared/binary";

const HEADER = Buffer.from("RGSSAD\0", "ascii");
const INITIAL_KEY = 0xdeadcafe; // v1 目录密钥的协议初值。
const MAX_NAME_BYTES = 32 * 1024;
export type RGSSArchiveMember = Readonly<{
  name: string;
  offset: number;
  size: number;
  key: number;
}>;

/** 协议版本独立于引擎代际，XP 和 VX 均使用 v1。 */
export function read_rgss_archive_version(header: Uint8Array): 1 | 3 {
  if (header.length < 8 || !HEADER.equals(Buffer.from(header.subarray(0, 7))))
    throw new Error("Invalid RGSS archive header");
  const version = header[7];
  if (version !== 1 && version !== 3) throw new Error("Unsupported RGSS archive version");
  return version;
}

/** 文件句柄由准备操作持有，清单和成员读取共享同一归档。 */
export async function read_rgss_archive(
  handle: BinaryFileHandle,
  signal?: AbortSignal,
): Promise<RGSSArchiveMember[]> {
  const length = (await handle.stat()).size;
  let cursor = 0; // 目录读取位置，v1 还需跨过交错存放的成员内容。
  /** 目录字段先验证范围，再分配并读满字节。 */
  async function read(size: number): Promise<Buffer> {
    signal?.throwIfAborted();
    if (cursor + size > length) throw new Error("Truncated RGSS archive");
    const result = await read_bytes(handle, cursor, size);
    cursor += size;
    return result;
  }
  const version = read_rgss_archive_version(await read(8));
  let key = version === 1 ? INITIAL_KEY : (Math.imul((await read(4)).readUInt32LE(), 9) + 3) >>> 0;
  /** v1 每读一个目录字段推进密钥，v3 整个目录共用密钥。 */
  async function integer(): Promise<number> {
    const result = ((await read(4)).readUInt32LE() ^ key) >>> 0;
    if (version === 1) key = next_key(key);
    return result;
  }
  const members: RGSSArchiveMember[] = [];
  const paths = new ProjectAssetPathIndex();
  while (version === 3 || cursor < length) {
    const offset = version === 3 ? await integer() : 0;
    if (version === 3 && offset === 0) {
      await read(12); // v3 以完整的零偏移目录项结束。
      break;
    }
    const size = version === 3 ? await integer() : 0;
    const member_key = version === 3 ? await integer() : 0;
    const name_length = await integer();
    if (!name_length || name_length > MAX_NAME_BYTES)
      throw new Error("Invalid RGSS member name length");
    const name_bytes = await read(name_length);
    for (let i = 0; i < name_bytes.length; i++) {
      name_bytes[i] = name_bytes[i]! ^ (version === 1 ? key & 255 : (key >>> ((i % 4) * 8)) & 255);
      if (version === 1) key = next_key(key);
    }
    const name = validate_zip_member_path(
      new TextDecoder("utf-8", { fatal: true }).decode(name_bytes),
    );
    paths.add(name);
    const member_size = version === 1 ? await integer() : size;
    const member_offset = version === 1 ? cursor : offset;
    if (member_offset + member_size > length)
      throw new Error("RGSS member exceeds archive bounds: " + name);
    members.push({
      name,
      size: member_size,
      offset: member_offset,
      key: version === 1 ? key : member_key,
    });
    if (version === 1) cursor += member_size;
  }
  if (version === 3) {
    let end = cursor;
    for (const member of [...members].sort((a, b) => a.offset - b.offset)) {
      if (member.offset < end) throw new Error("Overlapping RGSS member: " + member.name);
      end = member.offset + member.size;
    }
  }
  return members;
}

/** 分块解密写入独占暂存文件，内存占用不随归档大小增长。 */
export async function extract_rgss_member(
  handle: BinaryFileHandle,
  member: RGSSArchiveMember,
  destination: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  fs.ensure_parent_dir(destination);
  const output = await fs.open_file(destination, "wx");
  try {
    let key = member.key;
    // IO 块与完整计算段均按四字节对齐，段内可从密钥低位重新开始。
    for (let position = 0; position < member.size; position += BINARY_IO_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const bytes = await read_bytes(
        handle,
        member.offset + position,
        Math.min(BINARY_IO_CHUNK_BYTES, member.size - position),
      );
      for (let step = 0; step < bytes.length; step += BINARY_COMPUTE_STEP_BYTES) {
        await setImmediate();
        signal?.throwIfAborted();
        key = decrypt_rgss_bytes(bytes.subarray(step, step + BINARY_COMPUTE_STEP_BYTES), key);
      }
      await write_bytes(output, bytes, position);
    }
  } finally {
    await output.close();
  }
}

/** 调用者跨段保存返回的密钥，非四字节尾段只在成员末尾出现。 */
function decrypt_rgss_bytes(bytes: Buffer, key: number): number {
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = bytes[i]! ^ ((key >>> ((i % 4) * 8)) & 255);
    if (i % 4 === 3) key = next_key(key);
  }
  return key;
}

/** RGSS 按无符号 32 位整数推进密钥，溢出属于协议。 */
function next_key(key: number): number {
  return (Math.imul(key, 7) + 3) >>> 0;
}
