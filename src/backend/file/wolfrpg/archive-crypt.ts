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
import { crc32 } from "node:zlib";
import { setImmediate } from "node:timers/promises";
import { WOLF_MAX_DATA_BYTES } from "./lz4";
import { aes_ctr, chacha20_xor, expand_aes_key, rng, type WolfAesKeys } from "./crypt";
import {
  BINARY_COMPUTE_STEP_BYTES,
  BINARY_IO_CHUNK_BYTES,
  read_bytes,
  type BinaryFileHandle,
} from "../shared/binary";
/** 模式标志随当前归档的密钥保存，分块处理共用同一上下文。 */
export type WolfKey = Uint8Array & { v35?: boolean; chacha?: boolean };
// 头部 marker 到密码模式的映射，A0/A1/A2/F1 需要同名配套密钥文件。
const WOLF_ARCHIVE_MODES = {
  100: "free-chacha",
  200: "F1",
  300: "legacy",
  314: "legacy",
  331: "wolf",
  350: "wolf",
  1000: "A0",
  1010: "A1",
  1020: "A2",
} as const;
export type WolfKeyType = "A0" | "A1" | "A2" | "F1";
// 配套密钥文件首字节到密钥类型的映射。
const WOLF_KEY_TYPES: Readonly<Record<number, WolfKeyType>> = {
  0xa0: "A0",
  0xa1: "A1",
  0xa2: "A2",
  0xf1: "F1",
};
type WolfArchiveVersion = keyof typeof WOLF_ARCHIVE_MODES;
/** 3.5 与 A2 共用 3.5 的密钥流、轮数和前缀长度规则。 */
export function is_wolf35(version: number): boolean {
  return (version >= 350 && version < 1000) || version >= 1020;
}
/** 无 DX 头返回 null；已识别的未知协议必须失败。 */
export function classify_wolf_archive(header: Buffer): WolfArchiveVersion | null {
  if (header.length < 2 || header.readUInt16LE() !== 0x5844) return null;
  const marker = header.length >= 48 ? header.readUInt16LE(46) : -1;
  assert(
    header.length >= 64 && header.readUInt16LE(2) === 8 && marker in WOLF_ARCHIVE_MODES,
    "Unsupported WOLF archive: crypt=" + marker,
  );
  return marker as WolfArchiveVersion;
}
/** 首字节只标识类型，内容由密钥派生校验。 */
export function classify_wolf_key(header: Buffer): WolfKeyType | null {
  return WOLF_KEY_TYPES[header[0] ?? -1] ?? null;
}

/** A1/A2 的自定义 RNG 链只在当前派生调用内保存状态。 */
async function pro_key_aes(seeds: Uint8Array, signal?: AbortSignal): Promise<WolfAesKeys> {
  let seed1 = seeds[0]!,
    seed2 = seeds[1]!,
    counter = 0;
  const data = Array.from({ length: 32 }, () => new Uint32Array(256));
  /** 第一种递推更新 `seed1`，后续链继续消费其状态。 */
  const next1 = () => {
    const part = seed1 ^ (((seed1 << 11) ^ seed1) >>> 8);
    let state = (Math.imul(1664525, (seed1 << 11) ^ part) + 1013904223) >>> 0;
    state ^= ((13 * part + 95) & 1) === 0 ? state >>> 3 : state << 2;
    if (state & 0x400) {
      state ^= state << 21;
      state ^= state >>> 9;
    } else {
      state ^= state << 2;
      state ^= state >>> 22;
    }
    if ((state & 0xfffff) === 0) state += 256;
    return (seed1 = state >>> 0);
  };
  /** 第二种递推与第一种共用 `seed1`，调用顺序属于派生协议。 */
  const next2 = () => {
    let state = (Math.imul(1664525, seed1) + 1013904223) >>> 0;
    const shift = (seed1 & 7) + 1;
    if (state % 3 === 1) state ^= state >>> shift;
    else if (state % 3 === 2) state = ~state + (state << shift);
    else state ^= state << shift;
    state >>>= 0;
    if (!state) state = 0x173bef;
    else if (!(state & 65535)) state ^= 0x55aa55aa;
    return (seed1 = state >>> 0);
  };
  /** 独立推进 `seed2`，为链混合提供另一条随机序列。 */
  const next3 = () => {
    let state = Math.imul(1566083941, seed2) ^ Math.imul(292331520, seed2);
    state ^= (state >>> 17) ^ ((state ^ (state >>> 17)) << 5);
    state = Math.imul(69069, state ^ ((state ^ (state >>> 11)) & 0x3fffffff)) >>> 0;
    if (!state) state = 1566083941;
    else {
      if (!(state & 65535)) state ^= 0x59a6f141;
      if (!(state & 0xfffff)) state += 256;
    }
    return (seed2 = state >>> 0);
  };
  /** 原地改写状态行，跨行保留随机状态和调用计数。 */
  const chain = (row: Uint32Array) => {
    for (let i = 0; i < row.length; i++) {
      const rn = next2();
      let value = (rn ^ next3()) >>> 0;
      counter = (counter + 1) >>> 0;
      if (!(counter & 1)) value = (value + next3()) >>> 0;
      if (!(counter % 3)) value = (value ^ (next1() + 3)) >>> 0;
      if (!(counter % 7)) value = (value + next3() + 1) >>> 0;
      if (!(counter & 7)) value = Math.imul(value, next1()) >>> 0;
      if (!(((i + seed1) >>> 0) % 5)) value = (value ^ next1()) >>> 0;
      if (!(counter % 9)) value = (value + next2() + 4) >>> 0;
      if (!(counter % 24)) value = (value + next2() + 7) >>> 0;
      if (!(counter % 31)) value = (value + Math.imul(3, next3())) >>> 0;
      if (!(counter % 61)) value = (value + next3() + 1) >>> 0;
      if (!(counter % 161)) value = (value + next2()) >>> 0;
      if ((rn & 65535) === 256) value = (value + Math.imul(3, next3())) >>> 0;
      row[i] = value;
    }
  };
  for (const row of data) {
    await setImmediate();
    signal?.throwIfAborted();
    chain(row);
  }
  const crypt = new Uint8Array(48);
  for (let idx = 0; idx < crypt.length; idx++) {
    await setImmediate();
    signal?.throwIfAborted();
    let a2 = (idx + seeds[3]!) >>> 0,
      a3 = (seeds[2]! - idx) >>> 0;
    for (let i = 0, iterations = 20; i < iterations; i++) {
      const row = (a2 ^ next1()) & 31,
        column = (a3 ^ next2()) & 255;
      a3 = data[row]![column]!;
      switch (((a2 + counter) >>> 0) % 20) {
        case 1:
          chain(data[(a2 + 5) & 31]!);
          break;
        case 2:
          a3 = (a3 ^ next1()) >>> 0;
          break;
        case 5:
          if (!(a2 & 0xfffff)) crypt[idx]! ^= next3();
          break;
        case 9:
        case 14:
          crypt[next2() % 48]! += a3;
          break;
        case 11:
          crypt[idx]! ^= next1();
          break;
        case 17:
          iterations++;
          break;
        case 19:
          if (!(a2 & 65535)) crypt[idx]! ^= next2();
          break;
      }
      a2 = (a2 + next3()) >>> 0;
      iterations = Math.min(iterations, 50);
    }
    crypt[idx]! += a3;
  }
  const indexes = Uint8Array.from({ length: 48 }, (_, i) => i),
    random = rng(seeds[1]! ^ seeds[2]!);
  for (let i = 0; i < indexes.length; i++) {
    const j = random() % 48;
    [indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
  }
  const result = Uint8Array.from(indexes, (i) => crypt[i]!);
  return {
    key: expand_aes_key(result.subarray(0, 16)),
    iv: result.subarray(16, 32),
  };
}

/** 密钥头只标识类型，长度、取样位置和 NUL/tail 都在 worker 内校验。 */
export async function derive_archive_key(
  input: Buffer,
  type: WolfKeyType,
  signal?: AbortSignal,
): Promise<Buffer> {
  assert(
    input.length >= 31 && classify_wolf_key(input) === type,
    "Invalid WOLF companion key: " + type,
  );
  const bytes = Buffer.from(input),
    size = bytes.length - 31;
  if (type === "F1") {
    const x = size ^ 0x70,
      div4 = Math.floor(size / 4) + 1285;
    const dynamic = Uint8Array.from([
      div4 ^ (Math.floor(size / 2) + 171),
      x + (size % 1611) + 152,
      x - div4,
      Math.imul(div4, x),
    ]);
    const m1 = [0x3f, 0xa7, 0xd2, 0x1c],
      m2 = [0xb4, 0xe1, 0x9d, 0x58],
      m3 = [0x6a, 0x2b, 0x4c, 0x8e];
    return Buffer.from(
      Array.from({ length: 64 }, (_, i) => {
        const j = i % 4,
          t = ((dynamic[j]! + m2[j]!) ^ (m1[j]! + 17 * i)) & 255;
        return ~(rotr(t, i % 2 ? 2 : 5) ^ dynamic[j]! ^ m3[j]!) & 255;
      }),
    );
  }
  const length = bytes[19]!;
  assert(length > 0, "Empty WOLF companion password");
  if (type === "A0") {
    assert(bytes.length >= 0x5cb8, "Truncated WOLF A0 key");
    const random = rng(bytes[4]!);
    for (let i = 20; i < bytes.length; i++) {
      if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
        await setImmediate();
        signal?.throwIfAborted();
      }
      bytes[i]! ^= random() >> 12;
    }
    const result = Buffer.from(
      Array.from({ length }, (_, i) => bytes[30 + i * Math.floor(0x58b1 / length)]!),
    );
    return result[result.length - 1] === 0 ? result : Buffer.concat([result, Buffer.of(0)]);
  }
  assert(size > 0, "Truncated WOLF Pro key");
  const v1 = Math.floor(size / 3) + 71,
    v2 = size ^ 0x70,
    v3 = (size % 1200) + 152,
    v4 = (size * 3 + 85) >>> 0;
  const tail = Buffer.from([v4 ^ v1, v3 + v2, v2 - v4, Math.imul(v2, v4)]);
  const seeds = Uint8Array.from([v1 + bytes[3]!, v3 + bytes[7]!, v2 + bytes[5]!, v4 + bytes[6]!]);
  await aes_ctr(bytes.subarray(30, 30 + size), await pro_key_aes(seeds, signal), 0, signal);
  let step = bytes[4]! + ((bytes[3]! * bytes[6]!) & 1023);
  for (; ; step++) {
    let a = size,
      b = step;
    while (b) [a, b] = [b, a % b];
    if (a <= 1) break;
  }
  const result = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    const at = ((i * step) % size) + 30 + bytes[7]!;
    assert(at < bytes.length, "WOLF companion password exceeds file");
    result[i] = bytes[at]!;
  }
  assert(!result.includes(0), "Invalid WOLF Pro password terminator");
  return Buffer.concat([result, Buffer.of(0), tail]);
}
// 3.31 未提供密码时的外层密钥盐。
const SALT_PASSWORD_331 = Uint8Array.from([
  0xca, 0x08, 0x4c, 0x5d, 0x17, 0x0d, 0xda, 0xa1, 0xd7, 0x27, 0xc8, 0x41, 0x54, 0x38, 0x82, 0x32,
  0x54, 0xb7, 0xf9, 0x46, 0x8e, 0x13, 0x6b, 0xca, 0xd0, 0x5c, 0x95, 0x95, 0xe2, 0xdc, 0x03, 0x53,
  0x60, 0x9b, 0x4a, 0x38, 0x17, 0xf3, 0x69, 0x59, 0xa4, 0xc7, 0x9a, 0x43, 0x63, 0xe6, 0x54, 0xaf,
  0xdb, 0xbb, 0x43, 0x58,
]);
// 3.00 与 3.14 的内置成员密码。
export const OLD_PASSWORDS: Readonly<Record<number, Buffer>> = {
  300: Buffer.from([
    0x0f, 0x53, 0xe1, 0x3e, 0x8e, 0xb5, 0x41, 0x91, 0x52, 0x16, 0x55, 0xae, 0x34, 0xc9, 0x8f, 0x79,
    0x59, 0x2f, 0x59, 0x6b, 0x95, 0x19, 0x9b, 0x1b, 0x35, 0x9a, 0x2f, 0xde, 0xc9, 0x7c, 0x12, 0x96,
    0xc3, 0x14, 0xb5, 0x0f, 0x53, 0xe1, 0x3e, 0x8e,
  ]),
  314: Buffer.from([
    0x31, 0xf9, 0x01, 0x36, 0xa3, 0xe3, 0x8d, 0x3c, 0x7b, 0xc3, 0x7d, 0x25, 0xad, 0x63, 0x28, 0x19,
    0x1b, 0xf7, 0x8e, 0x6c, 0xc4, 0xe5, 0xe2, 0x76, 0x82, 0xea, 0x4f, 0xed, 0x61, 0xda, 0xe0, 0x44,
    0x5b, 0xb6, 0x46, 0x3b, 0x06, 0xd5, 0xce, 0xb6, 0x78, 0x58, 0xd0, 0x7c, 0x82,
  ]),
};
/** 旧版密钥由交错字节的两个 CRC32 拼成七字节。 */
export function old_key(source: Uint8Array): Buffer {
  const a: number[] = [],
    b: number[] = [];
  for (let i = 0; i < source.length; i++) (i % 2 ? b : a).push(source[i]!);
  const key = Buffer.alloc(7);
  key.writeUInt32LE(crc32(Uint8Array.from(a)), 0);
  key.writeUIntLE(crc32(Uint8Array.from(b)) & 0xffffff, 4, 3);
  return key;
}
/** 按单字节循环右移并截断高位。 */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (8 - n))) & 255;
}
/** 分别派生外层归档流与内层成员流的 XOR 密钥。 */
export function generate_key(
  seed_bytes: Uint8Array,
  outer: boolean,
  version: number,
  password?: Uint8Array,
  tail?: Uint8Array,
): WolfKey {
  let s = 0;
  for (let i = 0; i < Math.floor(seed_bytes[outer ? 8 : 11]! / (outer ? 4 : 3)); i++)
    s = i ^ rotr(s ^ seed_bytes[i % 15]!, outer ? 2 : 3);
  const next = rng(seed_bytes[2]! * seed_bytes[5]! + seed_bytes[12]! + s);
  const f = [0, 0, 0];
  f[s % 3] = next() % 256;
  if (!outer && is_wolf35(version)) f[1] = next() % 251;
  const k: WolfKey = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const rn = next();
    k[i] = f[0]! ^ next();
    k[i + 256] = f[1]! ^ (rn >> 8);
    k[i + 512] = f[2]! ^ rn;
  }
  if (tail) {
    for (let j = 0; j < 128; j++) {
      const rn = next();
      k[j]! ^= s ^ tail[2]! ^ (rn >> 8);
      k[j + 256]! ^= s ^ tail[0]! ^ rn;
    }
  }
  if (outer) {
    const saltKey = password ?? (version === 350 ? Buffer.from("958") : SALT_PASSWORD_331);
    const salt = Uint8Array.from(
      { length: 128 },
      (_, i) => Math.floor(i / saltKey.length) + saltKey[i % saltKey.length]!,
    );
    if (is_wolf35(version)) s = (s + 34) & 255;
    for (let i = 0; i < 3; i++) {
      let t = s;
      for (let j = 0; j < 256; j++) {
        const a = salt[j & 127]!,
          b = salt[(j + i) % 128]!,
          c = k[i * 256 + j]!,
          x = a ^ c,
          round = (b | (a << 8)) % (is_wolf35(version) ? 16 : 7);
        let n = x,
          skip = false;
        switch (round) {
          case 1:
            if (b % 11 === 0) n = c;
            break;
          case 2:
            if (a % 29 === 0) n = ~x;
            break;
          case 3:
            if ((round + j) % 37 === 0) n = b ^ x;
            break;
          case 4:
            if ((a + b) % 97 === 0) n = a + x;
            break;
          case 5:
            if ((j * round) % 123 === 0) n = x ^ t;
            break;
          case 6:
            if (a === 255 && b === 0) {
              n = 0;
              skip = true;
            }
            break;
          case 7:
            if ((round + j) % 51 === 0 || version >= 1020) n ^= a;
            break;
          case 8:
            if (a % 29 === 0 || version >= 1020) n ^= a;
            break;
        }
        if ((j + i) % ((a % 5) + 1) === 0) n ^= t;
        else if (skip) n = ~x;
        k[i * 256 + j] = n;
        t += i;
      }
    }
  }
  k.v35 = is_wolf35(version);
  return k;
}
/** 按流中的绝对位置异或，分块边界不重置密钥位置。 */
export function xor(data: Buffer, key: WolfKey | null, start: number): Buffer {
  if (key === null) return data;
  if (key.chacha) {
    return chacha20_xor(data, key.subarray(0, 32), key.subarray(34, 46), start);
  }
  if (key.length === 7) {
    for (let i = 0; i < data.length; i++) data[i]! ^= key[(start + i) % 7]!;
    return data;
  }
  if (key.v35) {
    const modified = Uint8Array.from({ length: 512 }, (_, i) => key[i % 256]! ^ (7 * i));
    for (let i = 0; i < data.length; i++) {
      const p = start + i;
      data[i]! ^= modified[p & 255]! ^ modified[(Math.floor(p / 256) & 255) + 256]!;
    }
    return data;
  }
  for (let i = 0; i < data.length; i++) {
    const p = start + i;
    data[i]! ^=
      key[p & 255]! ^ key[((p >>> 8) & 255) + 256]! ^ key[(Math.floor(p / 65536) & 255) + 512]!;
  }
  return data;
}
/** Pro 的四字节 tail 同时参与密钥与计数器派生。 */
export function aes_keys(
  seed_bytes: Uint8Array,
  version: number,
  tail: Uint8Array = new Uint8Array(4),
): WolfAesKeys {
  const key = new Uint8Array(16),
    iv = new Uint8Array(16);
  for (let i = 0; i < 15; i++) {
    const t = tail[i % 4]!,
      t2 = tail[(i + 2) % 4]!;
    if (is_wolf35(version)) {
      const ki = ((i * ((t % 5) + 7)) ^ (3 * seed_bytes[i]!)) % 15;
      const vi = ((i * ((tail[(i + 1) % 4]! % 7) + 11)) ^ (5 * seed_bytes[(i + 3) % 15]!)) % 15;
      key[i] = ((i ^ t) + (seed_bytes[ki]! << (i % 3))) % 251;
      iv[i] = ((seed_bytes[vi]! >> (i % 2)) + ((i * i) ^ t2)) % 246;
      key[15]! ^= (7 * (seed_bytes[i]! + ((i + 1) ^ t))) % 253;
      iv[15]! ^= (11 * ((seed_bytes[i]! - ((i * 2) ^ t2)) & 65535)) % 256;
    } else if (version === 1010) {
      key[i] = (seed_bytes[(i * 7) % 15]! + t) * i * i;
      iv[i] = seed_bytes[(i * 11) % 15]! + t2 - i * i;
      key[15]! ^= i * 3 + seed_bytes[i]! + t;
      iv[15]! ^= i * 5 + seed_bytes[i]! + t2;
    } else {
      key[i] = seed_bytes[(i * 7) % 15]! + i * i;
      iv[i] = seed_bytes[(i * 11) % 15]! - i * i;
      key[15]! ^= seed_bytes[i]! + i * 3;
      iv[15]! ^= seed_bytes[i]! + i * 5;
    }
  }
  for (let i = 0; i < 4; i++) {
    key[i * 4]! ^= tail[i]!;
    iv[[10, 1, 4, 7][i]!]! ^= tail[i]!;
  }
  return { key: expand_aes_key(key), iv };
}

const HEADER_BYTES = 64;
const MAX_DIRECTORY_BYTES = 32 * 1024 * 1024; // 目录区读取上限，拒绝损坏偏移造成的超大分配。
// 免费版 ChaCha 归档的内置密钥。
export const FREE_CHACHA_KEY = Buffer.from(
  "c982f8b42c939e830ebcbc92688d59a14a9e7fb0acaf1d8f8eb83b9ee889d9ad0000ffbc2dab9d8b0fb4bb9a6985".padEnd(
    128,
    "0",
  ),
  "hex",
);
/** 原 marker 直接决定密码上下文，只有需要配套密钥的模式才调用 `resolve_key`。 */
export async function open_wolf_archive_crypt(
  handle: BinaryFileHandle,
  resolve_key?: (type: WolfKeyType) => Promise<Buffer>,
  signal?: AbortSignal,
) {
  const file_size = (await handle.stat()).size;
  /** 读取当前归档的有界区间，IO 按块检查取消。 */
  const raw = async (offset: number, size: number): Promise<Buffer> => {
    assert(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(size) &&
        offset >= 0 &&
        size >= 0 &&
        offset + size <= file_size,
      "WOLF archive range exceeds file",
    );
    assert(size <= WOLF_MAX_DATA_BYTES, "WOLF member exceeds data limit");
    const result = Buffer.alloc(size);
    for (let at = 0; at < size; at += BINARY_IO_CHUNK_BYTES) {
      await setImmediate();
      signal?.throwIfAborted();
      const bytes = await read_bytes(
        handle,
        offset + at,
        Math.min(BINARY_IO_CHUNK_BYTES, size - at),
      );
      result.set(bytes, at);
    }
    return result;
  };
  const head = await raw(0, HEADER_BYTES);
  const version = classify_wolf_archive(head);
  assert(version !== null, "Unsupported WOLF archive header");
  const mode = WOLF_ARCHIVE_MODES[version];
  const modern = mode === "wolf" || mode === "A1" || mode === "A2";
  const chacha = mode === "free-chacha" || mode === "F1";
  const key_type = mode === "legacy" || mode === "wolf" || mode === "free-chacha" ? null : mode;
  const companion = key_type ? await resolve_key?.(key_type) : undefined;
  assert(!key_type || companion, "Missing WOLF companion key: " + mode);
  const nul = companion?.indexOf(0) ?? -1;
  const password = mode === "legacy" ? OLD_PASSWORDS[version]! : companion?.subarray(0, nul);
  const tail = mode === "A1" || mode === "A2" ? companion!.subarray(nul + 1) : undefined;
  assert(!tail || (nul > 0 && tail.length === 4), "Invalid WOLF Pro key tail");
  const stream: WolfKey | null = chacha ? Uint8Array.from(companion ?? FREE_CHACHA_KEY) : null;
  if (stream) stream.chacha = true;
  const pw = Uint8Array.from(head.subarray(49, 64));
  if (modern) {
    const random = rng(
      is_wolf35(version) ? 12 + pw[9]! * pw[10]! + pw[3]! : pw[0]! + pw[7]! * pw[12]!,
    );
    for (let i = 0; i < (is_wolf35(version) ? 2 : 4); i++)
      for (let j = 3; j >= 0; j--) {
        const p = 8 + i * 8 + j * 2;
        head.writeUInt16LE(head.readUInt16LE(p) ^ random(), p);
      }
    if (is_wolf35(version)) {
      const r0 = BigInt(random()) << 17n,
        r1 = BigInt(random()) << 31n;
      head.writeBigUInt64LE(head.readBigUInt64LE(24) ^ (r0 | r1 | BigInt(random())), 24);
      for (let i = 3; i >= 0; i--)
        head.writeUInt16LE(head.readUInt16LE(32 + i * 2) ^ random(), 32 + i * 2);
    }
  }
  /** 归档偏移先按无符号 64 位读取，再检查 JavaScript 的精确整数范围。 */
  const number = (at: number): number => {
    const value = head.readBigUInt64LE(at);
    assert(value <= BigInt(Number.MAX_SAFE_INTEGER), "Unsafe WOLF archive offset");
    return Number(value);
  };
  const data_offset = number(8),
    directory_offset = number(16),
    file_table = number(24),
    dir_table = number(32);
  const directory_size = head.readUInt32LE(4),
    flags = head.readUInt32LE(44) & 65535,
    huffman_kb = head[48]!;
  assert(
    data_offset === HEADER_BYTES &&
      directory_offset >= HEADER_BYTES &&
      directory_offset < file_size,
    "Invalid WOLF directory offset",
  );
  assert(
    directory_size <= MAX_DIRECTORY_BYTES && file_size - directory_offset <= MAX_DIRECTORY_BYTES,
    "WOLF directory exceeds limit",
  );
  assert((flags & ~3) === 0, "Unsupported WOLF archive flags: " + flags);
  const outer = modern ? generate_key(pw, true, version, password) : null;
  const inner = modern
    ? generate_key(pw, false, version, undefined, tail)
    : flags & 1
      ? null
      : (stream ?? old_key(password!));
  const aes = aes_keys(pw, version, tail);
  let prefix_size = Math.min(1024, file_size - HEADER_BYTES);
  if (is_wolf35(version)) {
    let state =
      (tail ? tail[0]! * tail[1]! + pw[2]! * pw[4]! + pw[11]! : pw[2]! * pw[4]! + pw[12]!) || 1;
    /** 3.5 的前缀长度取自该独立 xorshift 序列。 */
    const next = () => {
      state ^= state << 11;
      state ^= state >>> 19;
      state ^= state << 7;
      return state >>> 0;
    };
    next();
    if (file_size >= (next() % 500) + 800) next();
    prefix_size = file_size - HEADER_BYTES;
    if (prefix_size >= (next() % 500) + 800) prefix_size = (next() % 500) + 800;
  }
  /** 外层 XOR 排除头部与末尾保留区，偏移相对于整个归档。 */
  const outer_read = async (offset: number, size: number): Promise<Buffer> => {
    const bytes = await raw(offset, size);
    if (outer)
      for (let at = 0; at < size; at += BINARY_COMPUTE_STEP_BYTES) {
        await setImmediate();
        signal?.throwIfAborted();
        const start = Math.max(offset + at, HEADER_BYTES),
          end = Math.min(
            offset + at + BINARY_COMPUTE_STEP_BYTES,
            offset + size,
            file_size - HEADER_BYTES,
          );
        if (start < end) xor(bytes.subarray(start - offset, end - offset), outer, start);
      }
    return bytes;
  };
  const prefix = modern
    ? await aes_ctr(await outer_read(HEADER_BYTES, prefix_size), aes, 0, signal)
    : Buffer.alloc(0);
  const directory = await outer_read(directory_offset, file_size - directory_offset);
  // 小归档的目录与前缀可以重叠，第二段 CTR 使用实际前缀消耗的块数。
  if (modern && directory_offset < HEADER_BYTES + prefix_size)
    prefix.copy(directory, 0, directory_offset - HEADER_BYTES);
  if (modern) await aes_ctr(directory, aes, Math.ceil(prefix.length / 16), signal);
  for (let at = 0; at < directory.length; at += BINARY_COMPUTE_STEP_BYTES) {
    await setImmediate();
    signal?.throwIfAborted();
    xor(directory.subarray(at, at + BINARY_COMPUTE_STEP_BYTES), inner, at);
  }
  /** 成员读取复用已解密前缀，避免重叠区域重复解密。 */
  const read = async (offset: number, size: number): Promise<Buffer> => {
    assert(offset + size <= directory_offset, "WOLF read exceeds data region");
    const content = await outer_read(offset, size);
    const start = Math.max(offset, HEADER_BYTES),
      end = Math.min(offset + size, HEADER_BYTES + prefix.length);
    if (start < end) prefix.copy(content, start - offset, start - HEADER_BYTES, end - HEADER_BYTES);
    return content;
  };
  return {
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
    member_key: (names: readonly Buffer[]): WolfKey | null =>
      modern || flags & 1 ? inner : (stream ?? old_key(Buffer.concat([password!, ...names]))),
  };
}
