/*!
 *  Copyright (c) 2024-2026 Sinflower
 *
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 *
 */
// Port of UberWolf f4191375d289171b1f29dbc5ca320133b2b4b96a.
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { BINARY_COMPUTE_STEP_BYTES } from "../shared/binary";
import { aes_ctr, expand_aes_key, rng, wolf_sha512, mt19937, pro_key_aes } from "./crypt";
import { WolfReader } from "./binary";
import { read_wolf_game, read_wolf_game_prefix } from "./game-data";

// 归档附带的提示前缀不属于散装数据头。
const DATA_MARKER = Buffer.from("Extracting data from encrypted files violates the guidelines.\0");
const CORE_HEADER_BYTES = 10;
const PRO_VERSIONS = [0x54, 0x55, 0x56, 0x57];
const PRO54_KEY_SIZE_AT = 15;
const PRO_AES_START = 20;
const PRO55_AES_BYTES = 326;
const PRO55_STREAM_WORDS = 128;
const PRO_HEADER_BYTES = 143; // Pro 保护头长度，还原后替换为原始魔数。
// 核心文件名到 SHA 盐与原始魔数的映射。
const CORE_TYPES = {
  "game.dat": ["basicD1", "005700004f4c00464d55"],
  "commonevent.dat": ["Commo2", "005700004f4c55464300"],
  "database.dat": ["DBase4", "005700004f4c55464d00"],
  "cdatabase.dat": ["DBase4", "005700004f4c55464d00"],
  "sysdatabase.dat": ["DBase4", "005700004f4c55464d00"],
  "tilesetdata.dat": ["TilesetA", "005700004f4c55464d00"],
} as const;

/** 识别核心主名及 `Data/BasicData/` 路径，其它路径返回 null。 */
function core_type(name: string): keyof typeof CORE_TYPES | null {
  const basename = name.toLowerCase().replace(/^data\/basicdata\//u, "");
  return basename in CORE_TYPES ? (basename as keyof typeof CORE_TYPES) : null;
}

/** 准备任务据此筛选需要读取的核心文件。 */
export function is_wolf_core(name: string): boolean {
  return core_type(name) !== null;
}

/** `project_seed` 为 null 时不转换配对描述，其余值均为有效种子。 */
export type WolfCoreRestoreResult = Readonly<{ bytes: Buffer; project_seed: number | null }>;

/** 返回 null 表示当前字节无需转换。数据库种子只属于当前文件的配对。 */
export async function restore_wolf_core(
  name: string,
  input: Buffer,
  signal?: AbortSignal,
): Promise<WolfCoreRestoreResult | null> {
  const basename = core_type(name);
  if (basename === null) return null;
  const content = input.subarray(0, DATA_MARKER.length).equals(DATA_MARKER)
    ? input.subarray(DATA_MARKER.length)
    : input;
  const pro = content[1] === 0x50,
    database = /^(?:c?database|sysdatabase)\.dat$/u.test(basename),
    game = basename === "game.dat",
    version = content[5]!;
  // 普通数据库没有遗留 XOR 包装，原始结构错误交给最终成员校验。
  if (!pro && (content[0] === 0 || database))
    return content === input ? null : { bytes: content, project_seed: null };
  assert(content.length >= CORE_HEADER_BYTES, "Truncated WOLF core protection: " + name);
  assert(!pro || PRO_VERSIONS.includes(version), "Unsupported WOLF core protection: " + name);
  const bytes = Buffer.from(content);
  let offset = CORE_HEADER_BYTES,
    project_seed: number | null = null;
  if (!pro || version === 0x54) {
    await restore_legacy(bytes, game, signal);
    if (pro) {
      const reader = new WolfReader(bytes, PRO54_KEY_SIZE_AT);
      const length = reader.uint();
      assert(length > 0, "Empty WOLF project seed");
      const key = reader.take(length);
      if (database) project_seed = key.readInt8() >>> 0;
      offset = reader.at;
    }
  } else {
    assert(bytes.length >= PRO_HEADER_BYTES, "Unsupported WOLF core protection: " + name);
    if (version === 0x57) await restore_pro57(bytes, basename, signal);
    else await restore_pro55(bytes, game, signal);
    offset = PRO_HEADER_BYTES;
    if (database) project_seed = version === 0x57 ? 0 : bytes[PRO_AES_START]!;
  }
  const magic = Buffer.from(CORE_TYPES[basename][1], "hex");
  if (!pro) magic[game ? 9 : 6] = 0; // 遗留 XOR 的原始布局使用 CP932。
  const result = Buffer.concat([magic, bytes.subarray(offset)]);
  if (game) {
    const { reader } = read_wolf_game_prefix(result),
      size_at = reader.at;
    assert(reader.uint() === content.length - 1, "Invalid protected WOLF Game.dat file size");
    result.writeUInt32LE(result.length - 1, size_at);
    read_wolf_game(result);
  }
  return { bytes: result, project_seed };
}

/** 遗留 XOR 和 0x54 共用三轮 MSVC 随机流，索引相对于正文。 */
async function restore_legacy(bytes: Buffer, game: boolean, signal?: AbortSignal): Promise<void> {
  const indexes = game ? [0, 8, 6] : [0, 3, 9];
  for (const [round, step] of [1, 2, 5].entries()) {
    const random = rng(bytes[indexes[round]!]!);
    for (let i = 0; i < bytes.length - CORE_HEADER_BYTES; i += step) {
      if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
        await setImmediate();
        signal?.throwIfAborted();
      }
      bytes[i + CORE_HEADER_BYTES]! ^= random() >>> 12;
    }
  }
}

/** 0x55/0x56 先还原 MT 字节流，再用解出的头字段派生 AES。 */
async function restore_pro55(bytes: Buffer, game: boolean, signal?: AbortSignal): Promise<void> {
  let seed = (bytes[0]! << 16) | (bytes[game ? 8 : 3]! << 8) | bytes[game ? 6 : 9]!;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  const random = mt19937(seed),
    stream = Uint32Array.from({ length: PRO55_STREAM_WORDS }, random);
  for (let i = CORE_HEADER_BYTES; i < bytes.length; i++) {
    if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    bytes[i]! ^= stream[i % stream.length]!;
  }
  const seeds = Uint8Array.from([
    bytes[7]! + 3 * bytes[11]!,
    bytes[12]! ^ bytes[13]!,
    bytes[14]! ^ bytes[7]!,
    bytes[13]! + bytes[7]! - bytes[11]!,
  ]);
  await aes_ctr(
    bytes.subarray(
      PRO_AES_START,
      PRO_AES_START + Math.min(bytes.length - PRO_AES_START, PRO55_AES_BYTES),
    ),
    await pro_key_aes(seeds, signal),
    0,
    signal,
  );
}

/** 0x57 使用带文件类型盐的 SHA512 和 AES。 */
async function restore_pro57(
  bytes: Buffer,
  basename: keyof typeof CORE_TYPES,
  signal?: AbortSignal,
): Promise<void> {
  const game = basename === "game.dat",
    salt = CORE_TYPES[basename][0];
  let state = (0x0b << 24) | (bytes[0]! << 16) | (bytes[game ? 8 : 3]! << 8) | bytes[game ? 6 : 9]!;
  state ^= state << 11;
  state ^= state >>> 19;
  state ^= state << 7;
  for (let i = CORE_HEADER_BYTES; i < bytes.length; i++) {
    if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    const value = (((state << 15) ^ state) >> 21) ^ (state << 15) ^ state;
    state = (value << 9) ^ value;
    bytes[i]! ^= state % 249; // P1 在此使用有符号余数。
  }
  const random = rng(bytes[12]!);
  let size = bytes.length - PRO_AES_START;
  if (size >= (random() % 126) + 200) size = Math.min(size, (random() % 126) + 200);
  const dynamic = Buffer.from(
    [
      (bytes[7]! + 2 * bytes[11]!) % 246,
      bytes[13]! ^ bytes[14]!,
      bytes[7]! ^ bytes[12]!,
      (bytes[7]! + bytes[13]! - bytes[11]!) & 255,
    ].map((x) => x || 1),
  );
  const digest = wolf_sha512(Buffer.concat([dynamic, Buffer.from(salt)]));
  await aes_ctr(
    bytes.subarray(PRO_AES_START, PRO_AES_START + size),
    {
      key: expand_aes_key(Buffer.from(digest.slice(12, 28))),
      iv: Buffer.from(digest.slice(73, 89)),
    },
    0,
    signal,
  );
}

/** 仅在还原配对数据库后调用，零和 0xffffffff 都是有效种子。 */
export async function restore_wolf_project(
  input: Buffer,
  seed: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const bytes = Buffer.from(input),
    random = rng(seed);
  for (let i = 0; i < bytes.length; i++) {
    if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    bytes[i]! ^= random() & 255;
  }
  return bytes;
}
