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
import { aes_ctr, expand_aes_key, rng, wolf_sha512 } from "./crypt";
import { read_wolf_game, read_wolf_game_prefix } from "./game-data";

// 归档附带的提示前缀不属于散装数据头。
const DATA_MARKER = Buffer.from("Extracting data from encrypted files violates the guidelines.\0");
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

/** 只识别 `Data/BasicData/` 下的核心文件，其它路径返回 null。 */
function core_type(name: string): keyof typeof CORE_TYPES | null {
  const basename = name.toLowerCase().replace(/^data\/basicdata\//u, "");
  return basename in CORE_TYPES ? (basename as keyof typeof CORE_TYPES) : null;
}

/** 准备任务据此筛选需要读取的核心文件。 */
export function is_wolf_core(name: string): boolean {
  return core_type(name) !== null;
}

/** 返回 null 表示当前字节无需转换；配对状态由准备任务拥有。 */
export async function restore_wolf_core(
  name: string,
  input: Buffer,
  signal?: AbortSignal,
): Promise<Readonly<{ bytes: Buffer; protected: boolean }> | null> {
  const basename = core_type(name);
  if (basename === null) return null;
  const content = input.subarray(0, DATA_MARKER.length).equals(DATA_MARKER)
    ? input.subarray(DATA_MARKER.length)
    : input;
  if (content[1] !== 0x50) return content === input ? null : { bytes: content, protected: false };
  assert(
    content.length >= PRO_HEADER_BYTES && content[5]! >= 0x57,
    "Unsupported WOLF core protection: " + name,
  );
  const bytes = Buffer.from(content),
    game = basename === "game.dat";
  const [salt, magic] = CORE_TYPES[basename];
  let state = (0x0b << 24) | (bytes[0]! << 16) | (bytes[game ? 8 : 3]! << 8) | bytes[game ? 6 : 9]!;
  state ^= state << 11;
  state ^= state >>> 19;
  state ^= state << 7;
  for (let i = 10; i < bytes.length; i++) {
    if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    const value = (((state << 15) ^ state) >> 21) ^ (state << 15) ^ state;
    state = (value << 9) ^ value;
    bytes[i]! ^= state % 249; // P1 在此使用有符号余数。
  }
  const random = rng(bytes[12]!);
  let size = bytes.length - 20;
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
    bytes.subarray(20, 20 + size),
    {
      key: expand_aes_key(Buffer.from(digest.slice(12, 28))),
      iv: Buffer.from(digest.slice(73, 89)),
    },
    0,
    signal,
  );
  const result = Buffer.concat([Buffer.from(magic, "hex"), bytes.subarray(PRO_HEADER_BYTES)]);
  if (game) {
    const { reader } = read_wolf_game_prefix(result),
      offset = reader.at;
    assert(reader.uint() === content.length - 1, "Invalid protected WOLF Game.dat file size");
    result.writeUInt32LE(result.length - 1, offset);
    read_wolf_game(result);
  }
  return { bytes: result, protected: true };
}

/** 仅本次还原过配对 `.dat` 时调用，避免重复准备再次 XOR。 */
export async function restore_wolf_project(input: Buffer, signal?: AbortSignal): Promise<Buffer> {
  const bytes = Buffer.from(input),
    random = rng(0);
  for (let i = 0; i < bytes.length; i++) {
    if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    bytes[i]! ^= random() & 255;
  }
  return bytes;
}
